import type {
  Changes,
  WriteDocument,
} from "@antelopejs/interface-database/common";
import {
  isJsonObjectValue,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "../types/json";
import { isString } from "../utils/guards";
import type { ExecuteResult } from "./types";

/** The instance tag the store adds to every row it reads: not a column of the table. */
export const INSTANCE_TAG_FIELD = "_instance";

/** A row as a store reads it: any object, its cells of any type. */
export type ReadRow = ExecuteResult["rows"][number];

/** A row as JSON without its instance tag, and the instance the tag named. */
export interface UntaggedRow {
  row: JsonObject | null;
  /** The tagged instance; `""` for the default instance or an untagged row. */
  instance: string;
}

/**
 * A value as the run stores it: its JSON form, a date as its ISO string. A
 * value JSON leaves out reads as undefined.
 */
export function toJson(value: ReadRow | null): JsonValue | undefined {
  const text = JSON.stringify(value);
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text);
  return isJsonValue(parsed) ? parsed : undefined;
}

/**
 * A row as JSON without its instance tag. Anything other than an object reads
 * as no row.
 */
export function untaggedRow(value: ReadRow | null): UntaggedRow {
  const json = toJson(value);
  if (json === undefined || !isJsonObjectValue(json)) {
    return { row: null, instance: "" };
  }
  const tag = json[INSTANCE_TAG_FIELD];
  return {
    row: Object.fromEntries(
      Object.entries(json).filter(([key]) => key !== INSTANCE_TAG_FIELD),
    ),
    instance: isString(tag) ? tag : "",
  };
}

/** The two rows of a change as JSON, and the instance of the changed row. */
export interface ChangeRows {
  old: JsonObject | null;
  new: JsonObject | null;
  instance: string;
}

/**
 * The two rows of a change as JSON: the form the run stores its payload in and
 * a re-run reads back (a date becomes its ISO string), so a run sees what its
 * re-run sees. A row the change does not carry is null. The rows leave out the
 * instance tag, which names the instance instead: the new row's, else the old
 * row's.
 */
export function jsonRows(change: Changes<WriteDocument>): ChangeRows {
  const before = untaggedRow(change.oldValue ?? null);
  const after = untaggedRow(change.newValue ?? null);
  return {
    old: before.row,
    new: after.row,
    instance: after.row ? after.instance : before.instance,
  };
}
