import type {
  ActionType,
  JsonObject,
  JsonSchema,
} from "@antelopejs/interface-dms-automation";
import { countRows } from "../service/browse";
import { OWN_CONNECTION } from "../service/database";
import { type ColumnFilter, readFilterMode } from "../service/rowFilter";
import { getRow, resolveConnection, selectionOf } from "../service/rows";
import type { JsonObject as RowObject } from "../types/json";
import { isString } from "../utils/guards";
import { parseFilter } from "../utils/query";
import { asStep } from "./errors";
import {
  booleanInput,
  objectInput,
  stringInput,
  type NodeInput,
} from "./inputs";

const NAME_LENGTH = 128;
const MAX_ID_LENGTH = 512;
const MAX_FILTERS = 20;
const MAX_FILTER_LENGTH = 200;

const TABLE_PORTS = {
  connection: {
    type: "string",
    title: "Connection",
    description: "`own` or an external connection id",
    default: OWN_CONNECTION,
    maxLength: NAME_LENGTH,
  },
  schema: {
    type: "string",
    title: "Schema",
    description: "Registered schema id",
    maxLength: NAME_LENGTH,
  },
  instance: {
    type: "string",
    title: "Instance",
    description:
      "Instance id, e.g. a tenant id; empty for the default instance",
    default: "",
    maxLength: NAME_LENGTH,
  },
  table: {
    type: "string",
    title: "Table",
    description: "Table name in the schema",
    maxLength: NAME_LENGTH,
  },
} satisfies Record<string, JsonSchema>;

interface TableInput {
  connection: string;
  schema: string;
  instance: string;
  table: string;
}

function tableInput(input: NodeInput): TableInput {
  return {
    connection: stringInput(input, "connection", {
      max: NAME_LENGTH,
      fallback: OWN_CONNECTION,
    }),
    schema: stringInput(input, "schema", { max: NAME_LENGTH, required: true }),
    instance: stringInput(input, "instance", { max: NAME_LENGTH }),
    table: stringInput(input, "table", { max: NAME_LENGTH, required: true }),
  };
}

type GetRowOutput = {
  found: boolean;
  row: RowObject | null;
  primaryKey: string | null;
};

export const getRowAction: ActionType<NodeInput, GetRowOutput> = {
  id: "database.get-row",
  name: "Get row",
  description:
    "Reads one row of a table by its key. Reads storage directly: DMS hooks and field modifiers are not applied, and hashed or encrypted fields are left out",
  icon: "i-ph-magnifying-glass",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      ...TABLE_PORTS,
      id: {
        type: "string",
        title: "Id",
        description: "Primary key value",
        minLength: 1,
        maxLength: MAX_ID_LENGTH,
      },
    },
    required: ["schema", "table", "id"],
  },
  outputSchema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "Whether the row exists" },
      row: {
        type: ["object", "null"],
        description:
          "The row as JSON, dates as ISO strings, without hashed or encrypted fields; null when not found",
      },
      primaryKey: {
        type: ["string", "null"],
        description: "Key column; null when the table declares none",
      },
    },
    required: ["found", "row", "primaryKey"],
  },
  execute(input) {
    return asStep(async () => {
      const target = tableInput(input);
      const id = stringInput(input, "id", {
        max: MAX_ID_LENGTH,
        required: true,
        exact: true,
      });
      const db = await resolveConnection(target.connection);
      return getRow(db, await selectionOf(db, target), id);
    });
  },
};

/**
 * The column filters of `count-rows`: a column name without `.`, and a
 * `is:<text>`, `contains:<text>` or `<text>` value. An unknown mode is
 * refused, not dropped.
 */
function columnFilters(raw: JsonObject): ColumnFilter[] {
  const entries = Object.entries(raw);
  if (entries.length > MAX_FILTERS) {
    throw new Error(`'filters' holds more than ${MAX_FILTERS} columns`);
  }
  return entries.map(([field, token]) => {
    if (!field || field.includes(".")) {
      throw new Error(
        `Filter column ${JSON.stringify(field)} must be a column name without "."`,
      );
    }
    if (!isString(token) || token.length > MAX_FILTER_LENGTH) {
      throw new Error(
        `Filter on ${field} must be a text of at most ${MAX_FILTER_LENGTH} characters`,
      );
    }
    const parsed = parseFilter(token) ?? { mode: "is", value: "" };
    const mode = readFilterMode(parsed.mode);
    if (!mode) {
      throw new Error(
        `Filter on ${field} has an unknown mode "${parsed.mode}": write is:<text> or contains:<text>`,
      );
    }
    return { field, mode, value: parsed.value };
  });
}

type CountRowsOutput = { count: number };

export const countRowsAction: ActionType<NodeInput, CountRowsOutput> = {
  id: "database.count-rows",
  name: "Count rows",
  description:
    "Counts the rows of a table, optionally filtered, in one instance or in every instance",
  icon: "i-ph-hash",
  sideEffects: false,
  inputSchema: {
    type: "object",
    properties: {
      ...TABLE_PORTS,
      allInstances: {
        type: "boolean",
        title: "All instances",
        description:
          "Count across every instance (own database only); leave Instance empty",
        default: false,
      },
      filters: {
        type: "object",
        title: "Filters",
        description:
          'Column filters, all required: `{ "status": "is:paid", "name": "contains:ada" }`',
        default: {},
        maxProperties: MAX_FILTERS,
        additionalProperties: { type: "string", maxLength: MAX_FILTER_LENGTH },
      },
      search: {
        type: "string",
        title: "Search",
        description:
          "Case-insensitive text found in any text, number or boolean column",
        default: "",
        maxLength: MAX_FILTER_LENGTH,
      },
    },
    required: ["schema", "table"],
  },
  outputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "Rows that match" },
    },
    required: ["count"],
  },
  execute(input) {
    return asStep(async () => {
      const target = tableInput(input);
      const allInstances = booleanInput(input, "allInstances", false);
      const filters = columnFilters(objectInput(input, "filters"));
      const search = stringInput(input, "search", { max: MAX_FILTER_LENGTH });
      const db = await resolveConnection(target.connection);
      const selection = await selectionOf(db, { ...target, allInstances });
      const count = await countRows(db, {
        ...selection,
        search: search || undefined,
        columnFilters: filters,
      });
      return { count };
    });
  },
};
