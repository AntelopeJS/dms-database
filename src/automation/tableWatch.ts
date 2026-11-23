import { Logging } from "@antelopejs/interface-core/logging";
import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE, Schema } from "@antelopejs/interface-database";
import type {
  Changes,
  WriteDocument,
} from "@antelopejs/interface-database/common";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { OWN_DATABASE } from "../service/database";
import { listSchemaInstances } from "../service/introspect";
import { type ChangeRows, jsonRows } from "../service/jsonRows";
import type { JsonObject } from "../types/json";
import { admitAutomationChange } from "./loopGuard";
import { procedureWrites } from "./origin";
import {
  isBoolean,
  isFunction,
  isObject,
  isRecord,
  isString,
} from "../utils/guards";

type WatchEventType = "insert" | "update" | "delete";

const EVENT_TYPES: readonly WatchEventType[] = ["insert", "update", "delete"];

interface TableWatchConfig {
  /**
   * Registered schema id + table name, the same identifiers the data browser
   * uses to address a table (see service/browse.ts resolveSelection).
   */
  schema: string;
  table: string;
  /** Change types to fire on; omitted means all. */
  eventTypes?: WatchEventType[];
  /** The instance watched; `""` or omitted for the default instance. */
  instance?: string;
  /** Watch every instance through one cross-instance feed. */
  allInstances?: boolean;
  /** Fire on the changes a procedure's `database.run-saved-query` makes too. */
  includeAutomationWrites?: boolean;
}

type TableWatchOutput = {
  type: WatchEventType;
  old: JsonObject | null;
  new: JsonObject | null;
  schema: string;
  table: string;
  instance: string;
  at: string;
  originProcedureId?: string;
  originRunId?: string;
};

/** What a watch reads, its settings checked. */
interface WatchScope {
  schema: string;
  table: string;
  /** `""` for the default instance; ignored with `allInstances`. */
  instance: string;
  allInstances: boolean;
  includeAutomationWrites: boolean;
  /** Tells this watch's changes apart in the procedure write registry. */
  watchId: string;
  /** When the watch opened its feed, in epoch milliseconds. */
  openedAt: number;
}

type ChangeRow = WriteDocument;

type ChangeFeed = AsyncGenerator<Changes<ChangeRow>, void, unknown>;

interface TableWatchHandle {
  stopped: boolean;
  iterator: ChangeFeed;
  /** In-flight first read handed from activate()'s probe to the pump loop. */
  pending?: Promise<IteratorResult<Changes<ChangeRow>, void>>;
}

function isTableWatchHandle(handle: unknown): handle is TableWatchHandle {
  return (
    isObject(handle) &&
    "stopped" in handle &&
    isBoolean(handle.stopped) &&
    "iterator" in handle &&
    isObject(handle.iterator) &&
    "next" in handle.iterator &&
    isFunction(handle.iterator.next) &&
    "return" in handle.iterator &&
    isFunction(handle.iterator.return) &&
    (!("pending" in handle) ||
      handle.pending === undefined ||
      isObject(handle.pending))
  );
}

/**
 * The first read of a healthy change feed blocks until a change arrives, so
 * activate() cannot await success directly. Instead it waits this long for an
 * early failure (e.g. MongoDB standalone: "$changeStream is only supported on
 * replica sets") before assuming the feed opened.
 */
const ACTIVATION_PROBE_MS = 2_000;
/** Delay before the single reconnect attempt after a feed error. */
const RECONNECT_DELAY_MS = 5_000;

/**
 * interface-database change types → trigger event types. Driver passthrough
 * types (e.g. MongoDB "invalidate" / "drop") are ignored.
 */
const CHANGE_TYPE_TO_EVENT = {
  added: "insert",
  modified: "update",
  removed: "delete",
} satisfies Record<Changes<ChangeRow>["changeType"], WatchEventType>;

function sleep(ms: number): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

function watchLabel(scope: WatchScope): string {
  const instance = scope.allInstances
    ? "*"
    : scope.instance
      ? scope.instance
      : "default";
  return `table-watch ${scope.schema}.${scope.table} (instance ${instance})`;
}

function resolveEventTypes(
  raw: WatchEventType[] | undefined,
): Set<WatchEventType> {
  if (raw === undefined) return new Set(EVENT_TYPES);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "table-watch: eventTypes must be a non-empty array of insert|update|delete",
    );
  }
  const events = new Set<WatchEventType>();
  for (const entry of raw) {
    if (!EVENT_TYPES.includes(entry)) {
      throw new Error(
        `table-watch: unknown event type ${JSON.stringify(entry)} (expected insert|update|delete)`,
      );
    }
    events.add(entry);
  }
  return events;
}

/**
 * Opens a change feed cursor on the table: in one instance, or in every
 * instance through one cross-instance feed. Each read pulls one change;
 * closing the cursor (iterator.return) resolves a blocked read with done and
 * closes the server-side change stream.
 */
function openFeed(scope: WatchScope): ChangeFeed {
  const schema = Schema.get(scope.schema);
  if (!schema) throw new Error(`unknown schema "${scope.schema}"`);
  const instance = scope.allInstances
    ? CROSS_INSTANCE
    : scope.instance || undefined;
  return schema.instance(instance).table(scope.table).changes().cursor();
}

/**
 * A delete whose old row holds only its key: a cross-instance MongoDB feed
 * without a pre-image, which carries no instance tag.
 */
function isKeyOnlyDelete(rows: ChangeRows): boolean {
  if (rows.new !== null || rows.old === null) return false;
  const keys = Object.keys(rows.old);
  return keys.length === 1 && keys[0] === "_id";
}

/**
 * Fires the run of one change. A change a procedure's write made counts
 * against that write before the event-type filter, so the write's other
 * changes stay attributed; it fires only with `includeAutomationWrites`, and
 * then only while the loop guard admits its write.
 */
function emitChange(
  change: Changes<ChangeRow>,
  scope: WatchScope,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): void {
  const rows = jsonRows(change);
  const instance = scope.allInstances ? rows.instance : scope.instance;
  const origin = procedureWrites.attribute(
    { id: scope.watchId, openedAt: scope.openedAt },
    {
      schema: scope.schema,
      table: scope.table,
      instance:
        scope.allInstances && isKeyOnlyDelete(rows) ? undefined : instance,
    },
  );
  const type = CHANGE_TYPE_TO_EVENT[change.changeType];
  if (!type || !events.has(type)) return;
  if (origin) {
    if (!scope.includeAutomationWrites) return;
    if (
      !admitAutomationChange(
        watchLabel(scope),
        `${scope.watchId}|${origin.procedureId}`,
        origin.writeId,
      )
    ) {
      return;
    }
  }
  const payload: TableWatchOutput = {
    type,
    old: rows.old,
    new: rows.new,
    schema: scope.schema,
    table: scope.table,
    instance,
    at: new Date().toISOString(),
  };
  if (origin) {
    payload.originProcedureId = origin.procedureId;
    payload.originRunId = origin.runId;
  }
  emit(payload);
}

/**
 * Reads the feed until it stops. No await sits between the stopped check and
 * `next()`, so `deactivate()` cannot interleave and a read is never started on
 * a feed it already closed.
 */
async function drainFeed(
  handle: TableWatchHandle,
  scope: WatchScope,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): Promise<void> {
  while (!handle.stopped) {
    const read = handle.pending ?? handle.iterator.next();
    handle.pending = undefined;
    const result = await read;
    if (result.done) {
      if (handle.stopped) return;
      throw new Error("change feed ended unexpectedly");
    }
    if (handle.stopped) return;
    emitChange(result.value, scope, events, emit);
  }
}

/**
 * Reads the feed until deactivate() flips `stopped` (its iterator.return()
 * resolves a blocked read with done). Never throws: on a feed error — or the
 * feed ending on its own, which a healthy change feed never does — it attempts
 * ONE reconnect after a short delay, then gives up with an error log until the
 * trigger is re-activated. The failed iterator is closed before the feed is
 * reopened: it may still own a server-side change-stream cursor that would
 * otherwise linger until timeout.
 */
async function pumpFeed(
  handle: TableWatchHandle,
  scope: WatchScope,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): Promise<void> {
  let reconnected = false;
  while (!handle.stopped) {
    try {
      await drainFeed(handle, scope, events, emit);
      return;
    } catch (err) {
      if (handle.stopped) return;
      if (reconnected) {
        Logging.Error(
          `[dms-database] ${watchLabel(scope)}: change feed failed after reconnect, giving up:`,
          err,
        );
        return;
      }
      reconnected = true;
      Logging.Warn(
        `[dms-database] ${watchLabel(scope)}: change feed error, reconnecting in ${RECONNECT_DELAY_MS}ms:`,
        err,
      );
      await sleep(RECONNECT_DELAY_MS);
      if (handle.stopped) return;
      await handle.iterator.return(undefined).catch(() => undefined);
      if (handle.stopped) return;
      try {
        handle.iterator = openFeed(scope);
      } catch (reopenErr) {
        Logging.Error(
          `[dms-database] ${watchLabel(scope)}: reconnect failed, giving up:`,
          reopenErr,
        );
        return;
      }
    }
  }
}

const MAX_NAME_LENGTH = 128;

/**
 * The instance a watch reads: `""` for the default one, else a named instance
 * the schema lists. Refused together with `allInstances`.
 */
async function resolveInstance(
  schemaId: string,
  schema: Pick<Schema, "listInstances">,
  config: TableWatchConfig,
): Promise<string> {
  const raw: unknown = config.instance;
  if (raw !== undefined && !isString(raw)) {
    throw new Error("table-watch: 'instance' must be a string");
  }
  const instance = raw?.trim() ?? "";
  if (config.allInstances !== undefined && !isBoolean(config.allInstances)) {
    throw new Error("table-watch: 'allInstances' must be a boolean");
  }
  if (config.allInstances === true) {
    if (instance) {
      throw new Error(
        "table-watch: name an instance or watch every instance, not both",
      );
    }
    return "";
  }
  if (!instance) return "";
  if (instance.length > MAX_NAME_LENGTH) {
    throw new Error(
      `table-watch: 'instance' is longer than ${MAX_NAME_LENGTH} characters`,
    );
  }
  const named = await listSchemaInstances(OWN_DATABASE, schema);
  if (!named.includes(instance)) {
    throw new Error(
      `table-watch: unknown instance "${instance}" in schema "${schemaId}"`,
    );
  }
  return instance;
}

export const tableWatchTrigger: TriggerType<
  TableWatchConfig,
  TableWatchOutput
> = {
  id: "database.table-watch",
  name: "Table watch",
  description:
    "Fires on inserts, updates and deletes in a database table, in one instance or in every instance",
  icon: "i-ph-database",
  /**
   * The feed must be consumed exactly once cluster-wide; the automation
   * module only activates singleton triggers on the elected leader.
   */
  cluster: "singleton",
  configSchema: {
    type: "object",
    properties: {
      schema: {
        type: "string",
        title: "Schema",
        description: "Registered schema id, e.g. `dms`",
        maxLength: MAX_NAME_LENGTH,
      },
      table: {
        type: "string",
        title: "Table",
        description: "Table name inside the schema",
        maxLength: MAX_NAME_LENGTH,
      },
      eventTypes: {
        type: "array",
        title: "Event types",
        description: "Change types to fire on; omit for all",
        items: { type: "string", enum: [...EVENT_TYPES] },
        uniqueItems: true,
        minItems: 1,
      },
      instance: {
        type: "string",
        title: "Instance",
        description:
          "Instance to watch, e.g. a tenant id; empty for the default instance",
        default: "",
        maxLength: 128,
      },
      allInstances: {
        type: "boolean",
        title: "All instances",
        description:
          "Watch every instance through one feed; leave Instance empty",
        default: false,
      },
      includeAutomationWrites: {
        type: "boolean",
        title: "Include automation writes",
        description:
          "Also fire on changes a procedure makes with Run saved query",
        default: false,
      },
    },
    required: ["schema", "table"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: [...EVENT_TYPES] },
      old: {
        type: ["object", "null"],
        description:
          "Row before the change (null on insert; may hold only the primary key when the store has no pre-image)",
      },
      new: {
        type: ["object", "null"],
        description: "Row after the change (null on delete)",
      },
      schema: { type: "string" },
      table: { type: "string" },
      instance: {
        type: "string",
        description: "Instance of the changed row; empty for the default",
      },
      at: { type: "string", format: "date-time" },
      originProcedureId: {
        type: "string",
        description:
          "Procedure whose write made the change; only with Include automation writes",
      },
      originRunId: {
        type: "string",
        description:
          "Run whose write made the change; only with Include automation writes",
      },
    },
    required: ["type", "old", "new", "schema", "table", "instance", "at"],
  },
  /**
   * Opens the feed and probes it: an early open failure surfaces as an
   * activation error instead of a silent dead trigger. Failures past the probe
   * window go through the pump loop's reconnect-once path.
   */
  async activate(config, emit) {
    const schemaId = isString(config.schema) ? config.schema.trim() : "";
    const tableName = isString(config.table) ? config.table.trim() : "";
    if (!schemaId) throw new Error("table-watch: 'schema' is required");
    if (!tableName) throw new Error("table-watch: 'table' is required");
    for (const [name, value] of [
      ["schema", schemaId],
      ["table", tableName],
    ]) {
      if (value.length > MAX_NAME_LENGTH) {
        throw new Error(
          `table-watch: '${name}' is longer than ${MAX_NAME_LENGTH} characters`,
        );
      }
    }
    const schema = Schema.get(schemaId);
    if (!schema) {
      throw new Error(`table-watch: unknown schema "${schemaId}"`);
    }
    if (
      !isRecord(schema.definition) ||
      !Object.hasOwn(schema.definition, tableName)
    ) {
      throw new Error(
        `table-watch: unknown table "${tableName}" in schema "${schemaId}"`,
      );
    }
    const events = resolveEventTypes(config.eventTypes);
    const scope: WatchScope = {
      schema: schemaId,
      table: tableName,
      instance: await resolveInstance(schemaId, schema, config),
      allInstances: config.allInstances === true,
      includeAutomationWrites: config.includeAutomationWrites === true,
      watchId: randomUUID(),
      openedAt: Date.now(),
    };

    const iterator = openFeed(scope);
    const handle: TableWatchHandle = { stopped: false, iterator };
    const first = iterator.next();
    handle.pending = first;
    const probe = await Promise.race([
      first.then(
        () => undefined,
        (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
      ),
      sleep(ACTIVATION_PROBE_MS),
    ]);
    if (probe) {
      await iterator.return(undefined).catch(() => undefined);
      throw new Error(
        `table-watch: cannot open change feed on ${schemaId}.${tableName}: ${probe.message}`,
      );
    }
    void pumpFeed(handle, scope, events, emit);
    return handle;
  },
  /**
   * Resolves a blocked read with done and closes the server-side cursor. If the
   * pump is in its reconnect sleep, the flag alone stops it.
   */
  async deactivate(handle) {
    if (!isTableWatchHandle(handle) || handle.stopped) return;
    handle.stopped = true;
    await handle.iterator.return(undefined).catch(() => undefined);
  },
};
