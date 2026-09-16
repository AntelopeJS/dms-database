import { Logging } from "@antelopejs/interface-core/logging";
import { Schema, type Table } from "@antelopejs/interface-database";
import type { Changes } from "@antelopejs/interface-database/common";
import type { TriggerType } from "@antelopejs/interface-dms-automation";

type WatchEventType = "insert" | "update" | "delete";

const EVENT_TYPES: readonly WatchEventType[] = ["insert", "update", "delete"];

interface TableWatchConfig {
  // Registered schema id + table name, the same identifiers the data browser
  // uses to address a table (see routes/data.ts resolveSelection).
  schema: string;
  table: string;
  // Change types to fire on; omitted means all.
  eventTypes?: WatchEventType[];
}

interface TableWatchOutput {
  type: WatchEventType;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  schema: string;
  table: string;
  at: string;
}

type ChangeRow = Record<string, unknown>;
type ChangeFeed = AsyncGenerator<Changes<ChangeRow>, void, unknown>;

interface TableWatchHandle {
  stopped: boolean;
  iterator: ChangeFeed;
  // In-flight first read handed from activate()'s probe to the pump loop.
  pending?: Promise<IteratorResult<Changes<ChangeRow>, void>>;
}

// The first read of a healthy change feed blocks until a change arrives, so
// activate() cannot await success directly. Instead it waits this long for an
// early failure (e.g. MongoDB standalone: "$changeStream is only supported on
// replica sets") before assuming the feed opened.
const ACTIVATION_PROBE_MS = 2_000;
// Delay before the single reconnect attempt after a feed error.
const RECONNECT_DELAY_MS = 5_000;

// interface-database change types → trigger event types. Driver passthrough
// types (e.g. MongoDB "invalidate" / "drop") are ignored.
const CHANGE_TYPE_TO_EVENT: Record<string, WatchEventType | undefined> = {
  added: "insert",
  modified: "update",
  removed: "delete",
};

function sleep(ms: number): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

function watchLabel(config: TableWatchConfig): string {
  return `table-watch ${config.schema}.${config.table}`;
}

function resolveEventTypes(raw: unknown): Set<WatchEventType> {
  if (raw === undefined) return new Set(EVENT_TYPES);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "table-watch: eventTypes must be a non-empty array of insert|update|delete",
    );
  }
  const events = new Set<WatchEventType>();
  for (const entry of raw) {
    if (!EVENT_TYPES.includes(entry as WatchEventType)) {
      throw new Error(
        `table-watch: unknown event type ${JSON.stringify(entry)} (expected insert|update|delete)`,
      );
    }
    events.add(entry as WatchEventType);
  }
  return events;
}

// Opens a change feed cursor on the table (default schema instance). Each read
// pulls one change; closing the cursor (iterator.return) resolves a blocked
// read with done and closes the server-side change stream.
function openFeed(schemaId: string, tableName: string): ChangeFeed {
  const schema = Schema.get(schemaId);
  // Re-checked on reconnect; activate() has already rejected unknown names.
  if (!schema) throw new Error(`unknown schema "${schemaId}"`);
  const table: Table<ChangeRow> = schema.instance().table(tableName as never);
  return table.changes().cursor();
}

function emitChange(
  change: Changes<ChangeRow>,
  config: TableWatchConfig,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): void {
  const type = CHANGE_TYPE_TO_EVENT[change.changeType];
  if (!type || !events.has(type)) return;
  emit({
    type,
    old: change.oldValue ?? null,
    new: change.newValue ?? null,
    schema: config.schema,
    table: config.table,
    at: new Date().toISOString(),
  });
}

async function drainFeed(
  handle: TableWatchHandle,
  config: TableWatchConfig,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): Promise<void> {
  while (!handle.stopped) {
    // No await between the stopped check and next(): deactivate() cannot
    // interleave, so a read is never started on a feed it already closed.
    const read = handle.pending ?? handle.iterator.next();
    handle.pending = undefined;
    const result = await read;
    if (result.done) {
      if (handle.stopped) return;
      throw new Error("change feed ended unexpectedly");
    }
    if (handle.stopped) return;
    emitChange(result.value, config, events, emit);
  }
}

// Reads the feed until deactivate() flips `stopped` (its iterator.return()
// resolves a blocked read with done). Never throws: on a feed error — or the
// feed ending on its own, which a healthy change feed never does — it attempts
// ONE reconnect after a short delay, then gives up with an error log until the
// trigger is re-activated.
async function pumpFeed(
  handle: TableWatchHandle,
  config: TableWatchConfig,
  events: Set<WatchEventType>,
  emit: (payload: TableWatchOutput) => void,
): Promise<void> {
  let reconnected = false;
  while (!handle.stopped) {
    try {
      await drainFeed(handle, config, events, emit);
      return;
    } catch (err) {
      if (handle.stopped) return;
      if (reconnected) {
        Logging.Error(
          `[dms-database] ${watchLabel(config)}: change feed failed after reconnect, giving up:`,
          err,
        );
        return;
      }
      reconnected = true;
      Logging.Warn(
        `[dms-database] ${watchLabel(config)}: change feed error, reconnecting in ${RECONNECT_DELAY_MS}ms:`,
        err,
      );
      await sleep(RECONNECT_DELAY_MS);
      if (handle.stopped) return;
      // Close the failed iterator first: it may still own a server-side
      // change-stream cursor that would otherwise linger until timeout.
      await handle.iterator.return(undefined).catch(() => undefined);
      if (handle.stopped) return;
      try {
        handle.iterator = openFeed(config.schema, config.table);
      } catch (reopenErr) {
        Logging.Error(
          `[dms-database] ${watchLabel(config)}: reconnect failed, giving up:`,
          reopenErr,
        );
        return;
      }
    }
  }
}

export const tableWatchTrigger: TriggerType<
  TableWatchConfig,
  TableWatchOutput
> = {
  id: "database.table-watch",
  name: "Table watch",
  description: "Fires on inserts, updates and deletes in a database table",
  icon: "i-ph-database",
  // The feed must be consumed exactly once cluster-wide; the automation
  // module only activates singleton triggers on the elected leader.
  cluster: "singleton",
  configSchema: {
    type: "object",
    properties: {
      schema: {
        type: "string",
        title: "Schema",
        description: "Registered schema id, e.g. `dms`",
      },
      table: {
        type: "string",
        title: "Table",
        description: "Table name inside the schema",
      },
      eventTypes: {
        type: "array",
        title: "Event types",
        description: "Change types to fire on; omit for all",
        items: { type: "string", enum: [...EVENT_TYPES] },
        uniqueItems: true,
        minItems: 1,
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
      at: { type: "string", format: "date-time" },
    },
  },
  async activate(config, emit) {
    const schemaId =
      typeof config.schema === "string" ? config.schema.trim() : "";
    const tableName =
      typeof config.table === "string" ? config.table.trim() : "";
    if (!schemaId) throw new Error("table-watch: 'schema' is required");
    if (!tableName) throw new Error("table-watch: 'table' is required");
    const schema = Schema.get(schemaId);
    if (!schema) {
      throw new Error(`table-watch: unknown schema "${schemaId}"`);
    }
    if (!schema.definition[tableName]) {
      throw new Error(
        `table-watch: unknown table "${tableName}" in schema "${schemaId}"`,
      );
    }
    const events = resolveEventTypes(config.eventTypes);
    const scope: TableWatchConfig = { schema: schemaId, table: tableName };

    const iterator = openFeed(schemaId, tableName);
    const handle: TableWatchHandle = { stopped: false, iterator };
    // Probe the feed: surface an early open failure as an activation error
    // instead of a silent dead trigger. Failures past the probe window go
    // through the pump loop's reconnect-once path.
    const first = iterator.next();
    handle.pending = first;
    const probe = await Promise.race([
      first.then(
        () => undefined,
        (err) => (err instanceof Error ? err : new Error(String(err))),
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
  async deactivate(handle) {
    const h = handle as TableWatchHandle | undefined;
    if (!h || h.stopped) return;
    h.stopped = true;
    // Resolves a blocked read with done and closes the server-side cursor.
    // If the pump is in its reconnect sleep, the flag alone stops it.
    await h.iterator.return(undefined).catch(() => undefined);
  },
};
