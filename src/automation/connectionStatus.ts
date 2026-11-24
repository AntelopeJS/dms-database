import { Logging } from "@antelopejs/interface-core/logging";
import type {
  JsonSchema,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { listExternalIds } from "../service/connections";
import { OWN_CONNECTION } from "../service/database";
import {
  type ConnectionProbe,
  type ConnectionStatus,
  probeConnection,
} from "../service/health";
import { resolveConnection } from "../service/rows";
import {
  isBoolean,
  isFiniteNumber,
  isFunction,
  isObject,
  isString,
} from "../utils/guards";
import { clamp } from "../utils/query";

type Transition = "down" | "up";

const TRANSITIONS: readonly Transition[] = ["down", "up"];

interface ConnectionStatusConfig {
  connection?: string;
  intervalSeconds?: number;
  failuresBeforeDown?: number;
  fireOn?: Transition[];
}

type ConnectionStatusOutput = {
  connection: string;
  status: ConnectionStatus;
  previousStatus: ConnectionStatus | "unknown";
  latencyMs: number | null;
  error: string | null;
  since: string;
  checkedAt: string;
  deliveryId: string;
};

/** Probes one connection: never rejects, a failure reads as `down`. */
export type Probe = (connection: string) => Promise<ConnectionProbe>;

/** Runs `work` after `ms` milliseconds; resolves the cancel of that run. */
export type Schedule = (work: () => void, ms: number) => () => void;

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 3600;
const DEFAULT_FAILURES_BEFORE_DOWN = 2;
const MAX_FAILURES_BEFORE_DOWN = 10;
const MAX_CONNECTION_LENGTH = 128;
const REFUSED = "The database refused the probe: see the server log";

/** The probe the trigger runs: the console's health probe on the connection. */
export const probeNamedConnection: Probe = async (connection) => {
  try {
    return await probeConnection(await resolveConnection(connection));
  } catch (error) {
    Logging.Warn(
      `[dms-database] connection-status: ${connection} could not be probed`,
      error,
    );
    return { status: "down", latencyMs: null, error: REFUSED };
  }
};

const timerSchedule: Schedule = (work, ms) => {
  const timer = setTimeout(work, ms);
  return () => clearTimeout(timer);
};

/** What deactivation reads of a watch. */
interface WatchHandle {
  stopped: boolean;
  cancel?: () => void;
}

interface Watch extends WatchHandle {
  connection: string;
  intervalMs: number;
  failuresBeforeDown: number;
  fireOn: ReadonlySet<Transition>;
  status: ConnectionStatus | "unknown";
  since: Date;
  failures: number;
  firstFailureAt?: Date;
}

function isWatchHandle(handle: unknown): handle is WatchHandle {
  return (
    isObject(handle) &&
    "stopped" in handle &&
    isBoolean(handle.stopped) &&
    (!("cancel" in handle) ||
      handle.cancel === undefined ||
      isFunction(handle.cancel))
  );
}

function integerSetting(
  value: number | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!isFiniteNumber(value)) {
    throw new Error(`connection-status: '${name}' must be a number`);
  }
  return clamp(Math.round(value), min, max);
}

function resolveFireOn(raw: readonly string[] | undefined): Set<Transition> {
  if (raw === undefined) return new Set(TRANSITIONS);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "connection-status: fireOn must be a non-empty array of down|up",
    );
  }
  const fireOn = new Set<Transition>();
  for (const entry of raw) {
    const transition = TRANSITIONS.find((known) => known === entry);
    if (!transition) {
      throw new Error(
        `connection-status: unknown transition ${JSON.stringify(entry)} (expected down|up)`,
      );
    }
    fireOn.add(transition);
  }
  return fireOn;
}

function resolveConnectionId(raw: string | undefined): string {
  if (raw !== undefined && !isString(raw)) {
    throw new Error("connection-status: 'connection' must be a string");
  }
  const connection = raw?.trim() || OWN_CONNECTION;
  if (connection.length > MAX_CONNECTION_LENGTH) {
    throw new Error(
      `connection-status: 'connection' is longer than ${MAX_CONNECTION_LENGTH} characters`,
    );
  }
  if (
    connection !== OWN_CONNECTION &&
    !listExternalIds().includes(connection)
  ) {
    throw new Error(`connection-status: unknown connection "${connection}"`);
  }
  return connection;
}

function sinceMinute(since: Date): string {
  return since.toISOString().slice(0, 16);
}

/**
 * The status change one probe makes, or undefined when the status stays: a
 * connection is down after `failuresBeforeDown` failed probes in a row and up
 * again on the first probe that answers. The first status seen is kept
 * silently when it is up and reported, from `unknown`, when it is down.
 */
function observe(
  watch: Watch,
  probe: ConnectionProbe,
  checkedAt: Date,
): ConnectionStatusOutput | undefined {
  const previous = watch.status;
  if (probe.status === "ok") {
    watch.failures = 0;
    watch.firstFailureAt = undefined;
    if (previous === "ok") return undefined;
    watch.status = "ok";
    watch.since = checkedAt;
    if (previous === "unknown") return undefined;
  } else {
    watch.failures += 1;
    watch.firstFailureAt ??= checkedAt;
    if (previous === "down" || watch.failures < watch.failuresBeforeDown) {
      return undefined;
    }
    watch.status = "down";
    watch.since = watch.firstFailureAt;
  }
  const status = watch.status;
  return {
    connection: watch.connection,
    status,
    previousStatus: previous,
    latencyMs: status === "ok" ? probe.latencyMs : null,
    error: status === "ok" ? null : (probe.error ?? REFUSED),
    since: watch.since.toISOString(),
    checkedAt: checkedAt.toISOString(),
    deliveryId: `database.connection-status:${watch.connection}:${status}:${sinceMinute(watch.since)}`,
  };
}

const CONFIG_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    connection: {
      type: "string",
      title: "Connection",
      description: "`own` or an external connection id",
      default: OWN_CONNECTION,
      maxLength: MAX_CONNECTION_LENGTH,
    },
    intervalSeconds: {
      type: "integer",
      title: "Interval (seconds)",
      description: "Time between probes, 30 to 3600",
      default: DEFAULT_INTERVAL_SECONDS,
      minimum: MIN_INTERVAL_SECONDS,
      maximum: MAX_INTERVAL_SECONDS,
    },
    failuresBeforeDown: {
      type: "integer",
      title: "Failures before down",
      description:
        "Failed probes in a row before the connection counts as down",
      default: DEFAULT_FAILURES_BEFORE_DOWN,
      minimum: 1,
      maximum: MAX_FAILURES_BEFORE_DOWN,
    },
    fireOn: {
      type: "array",
      title: "Fire on",
      description: "Transitions to fire on",
      items: { type: "string", enum: [...TRANSITIONS] },
      default: [...TRANSITIONS],
      uniqueItems: true,
      minItems: 1,
    },
  },
  additionalProperties: false,
};

const OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    connection: { type: "string" },
    status: { type: "string", enum: ["ok", "down"] },
    previousStatus: {
      type: "string",
      enum: ["ok", "down", "unknown"],
      description: "`unknown` when the first status seen is down",
    },
    latencyMs: { type: ["number", "null"] },
    error: {
      type: ["string", "null"],
      description: "Why the connection is down; null when it is up",
    },
    since: { type: "string", format: "date-time" },
    checkedAt: { type: "string", format: "date-time" },
    deliveryId: {
      type: "string",
      description: "Same for one transition seen twice; dedupe on it",
    },
  },
  required: [
    "connection",
    "status",
    "previousStatus",
    "latencyMs",
    "error",
    "since",
    "checkedAt",
    "deliveryId",
  ],
};

/**
 * Builds the connection status trigger on a probe and a scheduler, which a
 * test replaces.
 *
 * @param probe Probes a connection
 * @param schedule Runs the next probe later
 * @param now The clock
 * @returns The trigger type
 */
export function createConnectionStatusTrigger(
  probe: Probe = probeNamedConnection,
  schedule: Schedule = timerSchedule,
  now: () => Date = () => new Date(),
): TriggerType<ConnectionStatusConfig, ConnectionStatusOutput, Watch> {
  async function tick(
    watch: Watch,
    emit: (payload: ConnectionStatusOutput) => void,
  ): Promise<void> {
    if (watch.stopped) return;
    const answer = await probe(watch.connection).catch((): ConnectionProbe => ({
      status: "down",
      latencyMs: null,
      error: REFUSED,
    }));
    if (watch.stopped) return;
    const change = observe(watch, answer, now());
    if (change) {
      const transition: Transition = change.status === "ok" ? "up" : "down";
      if (watch.fireOn.has(transition)) emit(change);
    }
    watch.cancel = schedule(() => void tick(watch, emit), watch.intervalMs);
  }

  return {
    id: "database.connection-status",
    name: "Connection status",
    description: "Fires when a database connection goes down or comes back up",
    icon: "i-ph-plugs",
    cluster: "singleton",
    configSchema: CONFIG_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    async activate(config, emit) {
      const watch: Watch = {
        stopped: false,
        connection: resolveConnectionId(config.connection),
        intervalMs:
          integerSetting(
            config.intervalSeconds,
            "intervalSeconds",
            DEFAULT_INTERVAL_SECONDS,
            MIN_INTERVAL_SECONDS,
            MAX_INTERVAL_SECONDS,
          ) * 1000,
        failuresBeforeDown: integerSetting(
          config.failuresBeforeDown,
          "failuresBeforeDown",
          DEFAULT_FAILURES_BEFORE_DOWN,
          1,
          MAX_FAILURES_BEFORE_DOWN,
        ),
        fireOn: resolveFireOn(config.fireOn),
        status: "unknown",
        since: now(),
        failures: 0,
      };
      void tick(watch, emit);
      return watch;
    },
    deactivate(watch) {
      if (!isWatchHandle(watch)) return Promise.resolve();
      watch.stopped = true;
      watch.cancel?.();
      return Promise.resolve();
    },
  };
}

export const connectionStatusTrigger = createConnectionStatusTrigger();
