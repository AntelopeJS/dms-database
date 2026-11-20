import type {
  DataNodeType,
  JsonValue as PortValue,
} from "@antelopejs/interface-dms-automation";
import {
  isJsonObject,
  isJsonObjectValue,
  type JsonObject,
  type JsonValue,
} from "../types/json";
import { isString } from "../utils/guards";

/** A value a port resolves to; undefined when nothing is wired. */
type NodeValue = PortValue | undefined;

const MAX_IGNORE_LENGTH = 1000;
const MAX_FIELD_LENGTH = 256;
const PRIMARY_KEY = "_id";

/**
 * Whether two JSON values are equal: objects whatever their key order,
 * arrays in order.
 */
export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index] ?? null))
    );
  }
  if (!isJsonObjectValue(left) || !isJsonObjectValue(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        jsonEqual(left[key] ?? null, right[key] ?? null),
    )
  );
}

function rowInput(value: NodeValue): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/**
 * Whether two rows of a change can be compared: not when both are missing,
 * nor when the old row holds only its key while the new one holds more (a
 * MongoDB change without a pre-image).
 */
export function isComplete(
  old: JsonObject | null,
  next: JsonObject | null,
): boolean {
  if (!old && !next) return false;
  if (!old || !next) return true;
  const oldKeys = Object.keys(old);
  return !(
    oldKeys.length === 1 &&
    oldKeys[0] === PRIMARY_KEY &&
    Object.keys(next).length > 1
  );
}

/** What differs between two rows. */
export interface RowDiff {
  changed: boolean;
  fields: string[];
  added: string[];
  removed: string[];
  before: JsonObject;
  after: JsonObject;
  complete: boolean;
}

/**
 * The top-level fields that differ between two rows, leaving out `ignore`.
 * Incomplete rows answer no change, `complete: false`.
 */
export function diffRows(
  old: JsonObject | null,
  next: JsonObject | null,
  ignore: readonly string[] = [],
): RowDiff {
  const complete = isComplete(old, next);
  if (!complete) {
    return {
      changed: false,
      fields: [],
      added: [],
      removed: [],
      before: {},
      after: {},
      complete,
    };
  }
  const before = old ?? {};
  const after = next ?? {};
  const keys = new Set(
    [...Object.keys(before), ...Object.keys(after)].filter(
      (key) => !ignore.includes(key),
    ),
  );
  const added: string[] = [];
  const removed: string[] = [];
  const fields: string[] = [];
  for (const key of keys) {
    const inBefore = Object.hasOwn(before, key);
    const inAfter = Object.hasOwn(after, key);
    if (!inBefore) added.push(key);
    else if (!inAfter) removed.push(key);
    else if (jsonEqual(before[key] ?? null, after[key] ?? null)) continue;
    fields.push(key);
  }
  fields.sort();
  added.sort();
  removed.sort();
  const valuesOf = (row: JsonObject): JsonObject =>
    Object.fromEntries(
      fields.map((key) => [
        key,
        Object.hasOwn(row, key) ? (row[key] ?? null) : null,
      ]),
    );
  return {
    changed: fields.length > 0,
    fields,
    added,
    removed,
    before: valuesOf(before),
    after: valuesOf(after),
    complete,
  };
}

/**
 * The value at a dot-separated path, own properties only, as `object.get`
 * reads it; null when absent.
 */
export function valueAt(row: JsonObject | null, path: string): JsonValue {
  let current: JsonValue | undefined = row;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) {
      current = Object.hasOwn(current, part)
        ? current[Number(part)]
        : undefined;
    } else if (
      current !== undefined &&
      current !== null &&
      isJsonObjectValue(current)
    ) {
      current = Object.hasOwn(current, part) ? current[part] : undefined;
    } else {
      return null;
    }
  }
  return current ?? null;
}

function ignoredFields(raw: NodeValue): string[] {
  if (raw === undefined || raw === null) return [];
  if (!isString(raw))
    throw new Error("'ignore' must be a comma-separated text");
  if (raw.length > MAX_IGNORE_LENGTH) {
    throw new Error(`'ignore' is longer than ${MAX_IGNORE_LENGTH} characters`);
  }
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

const ROW_PORTS = {
  old: {
    type: ["object", "null"],
    title: "Old row",
    description: "Row before the change (wire Table watch `old`)",
    default: null,
  },
  new: {
    type: ["object", "null"],
    title: "New row",
    description: "Row after the change (wire Table watch `new`)",
    default: null,
  },
};

const COMPLETE_PORT = {
  type: "boolean",
  description:
    "False when both rows are missing or the old row holds only its key (MongoDB without a pre-image); nothing is then reported as changed",
};

type RowDiffInput = { old?: NodeValue; new?: NodeValue; ignore?: NodeValue };

export const rowDiffNode: DataNodeType<RowDiffInput, RowDiff & JsonObject> = {
  id: "database.row-diff",
  category: "database",
  name: "Row diff",
  description:
    "Lists the fields that differ between the old and new rows of a Table watch event",
  icon: "i-ph-git-diff",
  inputSchema: {
    type: "object",
    properties: {
      ...ROW_PORTS,
      ignore: {
        type: "string",
        title: "Ignore",
        description:
          "Comma-separated top-level fields left out of the comparison, e.g. `updatedAt`",
        default: "",
        maxLength: MAX_IGNORE_LENGTH,
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      changed: { type: "boolean", description: "At least one field differs" },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields that differ (added, removed or changed), sorted",
      },
      added: {
        type: "array",
        items: { type: "string" },
        description: "Fields only in the new row",
      },
      removed: {
        type: "array",
        items: { type: "string" },
        description: "Fields only in the old row",
      },
      before: {
        type: "object",
        description: "Old values of the fields that differ (absent as null)",
      },
      after: {
        type: "object",
        description: "New values of the fields that differ (absent as null)",
      },
      complete: COMPLETE_PORT,
    },
    required: [
      "changed",
      "fields",
      "added",
      "removed",
      "before",
      "after",
      "complete",
    ],
  },
  evaluate(input) {
    return {
      ...diffRows(
        rowInput(input.old),
        rowInput(input.new),
        ignoredFields(input.ignore),
      ),
    };
  },
};

type FieldChangedInput = {
  old?: NodeValue;
  new?: NodeValue;
  field?: NodeValue;
};

type FieldChangedOutput = {
  changed: boolean;
  before: JsonValue;
  after: JsonValue;
  complete: boolean;
};

export const fieldChangedNode: DataNodeType<
  FieldChangedInput,
  FieldChangedOutput
> = {
  id: "database.field-changed",
  category: "database",
  name: "Field changed",
  description:
    "Tells whether one field differs between the old and new rows, with both values",
  icon: "i-ph-arrows-left-right",
  inputSchema: {
    type: "object",
    properties: {
      ...ROW_PORTS,
      field: {
        type: "string",
        title: "Field",
        description: "Field to compare; a dotted path reads a nested field",
        minLength: 1,
        maxLength: MAX_FIELD_LENGTH,
      },
    },
    required: ["field"],
  },
  outputSchema: {
    type: "object",
    properties: {
      changed: { type: "boolean", description: "The values differ" },
      before: { description: "Value in the old row (null when absent)" },
      after: { description: "Value in the new row (null when absent)" },
      complete: COMPLETE_PORT,
    },
    required: ["changed", "before", "after", "complete"],
  },
  evaluate(input) {
    const field = input.field;
    if (!isString(field) || !field.trim()) {
      throw new Error("field-changed: 'field' is required");
    }
    if (field.length > MAX_FIELD_LENGTH) {
      throw new Error(
        `field-changed: 'field' is longer than ${MAX_FIELD_LENGTH} characters`,
      );
    }
    const old = rowInput(input.old);
    const next = rowInput(input.new);
    const before = valueAt(old, field);
    const after = valueAt(next, field);
    const complete = isComplete(old, next);
    return {
      changed: complete && !jsonEqual(before, after),
      before,
      after,
      complete,
    };
  },
};
