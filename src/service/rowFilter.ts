import { assert } from "@antelopejs/interface-api-util";
import type { ValueProxy } from "@antelopejs/interface-database";
import type { StoredCell } from "../types/stored";

/**
 * How a column filter compares a cell with the user's text: `is` against the
 * whole value, `contains` against a part of it.
 */
export type FilterMode = "is" | "contains";

/** One `filter_<column>` of a browse request, its mode read and checked. */
export interface ColumnFilter {
  /** The column the filter reads. */
  field: string;
  mode: FilterMode;
  /** The text the user typed after the mode. */
  value: string;
}

/** The columns of a table and the grid kind of each, as the data browser lists them. */
export interface ColumnKinds {
  columns: readonly string[];
  types: Readonly<Record<string, string>>;
}

/** A condition on a value the database reads, built from proxies, never run in this process. */
type ProxyTest = (value: ValueProxy<unknown>) => ValueProxy<boolean>;

/** The answer of a filter no row can satisfy. */
export const NO_ROW = Symbol("no row matches");

/** What a filter asks of a row: a condition, or {@link NO_ROW}. */
export type RowMatch = ProxyTest | typeof NO_ROW;

/** The filter modes by the name a request gives them, which a `Map` keeps apart from `Object.prototype`. */
const FILTER_MODES = new Map<string, FilterMode>([
  ["is", "is"],
  ["contains", "contains"],
]);

/**
 * The filter mode a request names.
 *
 * @param name The text before the `:` of a filter token
 * @returns The mode, or undefined when none has that name
 */
export function readFilterMode(name: string): FilterMode | undefined {
  return FILTER_MODES.get(name);
}

/** How one kind of column reads a filter's text, one entry per {@link FilterMode}. */
type KindFilters = Record<FilterMode, (text: string) => RowMatch>;

/**
 * A pattern that matches `text` as a case-insensitive substring. Every regex
 * metacharacter is escaped, and so is a null character, which MongoDB refuses
 * in a pattern. `(?i)` makes a database fold Unicode case, which `downcase`
 * does not.
 */
function containsPattern(text: string): string {
  const escaped = text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  return `(?i)${escaped.replaceAll("\0", "\\x00")}`;
}

function anyOf(tests: readonly RowMatch[]): RowMatch {
  const live = tests.filter((test) => test !== NO_ROW);
  if (live.length === 0) return NO_ROW;
  return live.reduce((left, right) => (value) => left(value).or(right(value)));
}

function allOf(tests: readonly RowMatch[]): RowMatch | undefined {
  const live = tests.filter((test) => test !== NO_ROW);
  if (live.length < tests.length) return NO_ROW;
  if (live.length === 0) return undefined;
  return live.reduce((left, right) => (value) => left(value).and(right(value)));
}

/** A cell that equals one of `values`, or {@link NO_ROW} for none. */
function equalToAny(values: readonly (boolean | number)[]): RowMatch {
  return anyOf(
    values.map(
      (wanted): ProxyTest =>
        (cell) =>
          cell.eq(wanted),
    ),
  );
}

const TEXT_FILTERS: KindFilters = {
  is: (text) => (cell) => cell.eq(text),
  contains: (text) => (cell) =>
    cell.cast<string>().match(containsPattern(text)),
};

/** A number as the grid writes it: an optional sign, digits, and an optional decimal part. */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function wholeNumber(text: string): RowMatch {
  const trimmed = text.trim();
  if (!DECIMAL_NUMBER.test(trimmed)) return NO_ROW;
  return equalToAny([Number(trimmed)]);
}

const NUMBER_FILTERS: KindFilters = {
  is: wholeNumber,
  contains: wholeNumber,
};

const BOOLEANS = [true, false];

const BOOLEAN_FILTERS: KindFilters = {
  is: (text) =>
    equalToAny(BOOLEANS.filter((wanted) => String(wanted) === text)),
  contains: (text) =>
    equalToAny(
      BOOLEANS.filter((wanted) => String(wanted).includes(text.toLowerCase())),
    ),
};

/**
 * What a filter can compare, by the grid kind `fetchColumns` answers for a
 * column. A column the sample saw only empty reads as text. Any other kind
 * (dates, lists, objects, ...) has no entry: a filter or a search compares
 * text, numbers and true or false only.
 */
const FILTERS_BY_KIND = new Map<string, KindFilters>([
  ["string", TEXT_FILTERS],
  ["null", TEXT_FILTERS],
  ["undefined", TEXT_FILTERS],
  ["number", NUMBER_FILTERS],
  ["boolean", BOOLEAN_FILTERS],
]);

/** The kind of a column nobody sampled, such as an empty table's primary key. */
const UNSAMPLED_KIND = "undefined";

/** What a database reads a column name with as a path to a nested field. */
const NESTED_FIELD_SEPARATOR = ".";

/**
 * The filters a column takes, or undefined when a filter cannot compare it:
 * its kind has none, or its name holds a dot, which the query cannot name as
 * one field.
 */
function filtersOf(
  { types }: ColumnKinds,
  column: string,
): KindFilters | undefined {
  if (column.includes(NESTED_FIELD_SEPARATOR)) return undefined;
  const kind = Object.hasOwn(types, column) ? types[column] : UNSAMPLED_KIND;
  return FILTERS_BY_KIND.get(kind);
}

function onColumn(column: string, match: RowMatch): RowMatch {
  if (match === NO_ROW) return NO_ROW;
  return (row) => match(row.cast<Record<string, StoredCell>>().key(column));
}

/**
 * Reads a page's search and column filters as one condition on a row, run by
 * the database: every column filter must hold, and the search must hold on at
 * least one column whose kind a search can compare. A part no row can satisfy
 * makes the whole condition {@link NO_ROW}. The columns must already be known
 * to the table.
 *
 * @param meta The table's columns and their kinds
 * @param search The free-text search, if any
 * @param filters The column filters
 * @returns The condition, {@link NO_ROW}, or undefined when nothing narrows the rows
 */
export function buildRowFilter(
  meta: ColumnKinds,
  search: string | undefined,
  filters: readonly ColumnFilter[],
): RowMatch | undefined {
  const parts = filters.map(({ field, mode, value }) => {
    assert(
      !field.includes(NESTED_FIELD_SEPARATOR),
      400,
      `Cannot filter column ${field}: the database reads a dot in a column name as a nested field`,
    );
    const kind = filtersOf(meta, field);
    assert(
      kind,
      400,
      `Cannot filter column ${field}: a filter compares text, numbers and true or false only`,
    );
    return onColumn(field, kind[mode](value));
  });
  if (search) {
    parts.push(
      anyOf(
        meta.columns.flatMap((column) => {
          const kind = filtersOf(meta, column);
          return kind ? [onColumn(column, kind.contains(search))] : [];
        }),
      ),
    );
  }
  return allOf(parts);
}
