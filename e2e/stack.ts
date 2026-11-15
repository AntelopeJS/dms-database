import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

/** The backend's environment overlay: the `VERIFY_DATABASE_*` options a journey restarts the backend with. */
export type Env = Readonly<Record<string, string>>;

/** How the backend runs: on the build (`ajs project start`), or in development mode, which loads a module the build lacks. */
export type BackendMode = "production" | "dev";

/** The credentials of an account a journey signs in as. */
export interface Account {
  readonly email: string;
  readonly password: string;
  readonly userId?: string;
}

/** The administrator a reset onboarded, and the bearer token its login answered. */
export interface Session {
  readonly account: Account;
  readonly token: string;
}

/** What a test needs before its journey's first step. */
export interface Precondition {
  readonly onboard: boolean;
  readonly backend: BackendMode;
}

/**
 * The processes, ports, secrets, database and environment overlay one Playwright worker owns. Nothing starts before
 * the first {@link Stack.reset} or {@link Stack.restartBackend}: the MongoDB replica set and the dashboard then
 * start once, and the backend starts again on every reset and restart, on the same API port.
 */
export interface Stack {
  readonly apiUrl: string;
  readonly webUrl: string;
  /** The checkout, for the journeys that pack the module or read its files. */
  readonly repo: string;
  /** The overlay the running backend started with. */
  readonly env: Env;
  /**
   * Stops the backend, points it at a new database with an empty overlay, starts it, drops the previous database
   * and, when `onboard`, registers the administrator through `POST /api/onboarding/register` and logs it in.
   */
  reset(precondition: Precondition): Promise<Session | undefined>;
  /** Stops and starts the backend on the same database; `env` replaces the overlay, which stays as it is without one. */
  restartBackend(env?: Env): Promise<void>;
  /** The log of the backend's latest start. */
  backendLog(): string;
  /** How a process of the stack stopped without being asked to, or `null` while every one runs. */
  lost(): string | null;
  /** Stops the backend, the dashboard and MongoDB; safe to call twice. */
  stop(): Promise<void>;
}

const E2E = import.meta.dirname;
const REPO = resolve(E2E, "..");
const PLAYGROUND = join(E2E, "playground");
const ENVIRONMENT = "docs";
const MONGO_VERSION = "8.0.8";
const READY_TIMEOUT_MS = 180_000;
const STOP_GRACE_MS = 10_000;
const POLL_MS = 250;
const LOG_TAIL = 2_000;
const SECRET_BYTES = 32;
const PASSWORD_BYTES = 9;
const SECRET_NAMES = [
  "DMS_JWT_SECRET",
  "AUTH_JWT_SECRET",
  "DMS_BOOTSTRAP_SECRET",
  "DMS_HTML_RENDER_SECRET",
  "DMS_SESSION_SECRET",
  "DMS_SETUP_TOKEN",
];
const DROPPED_PREFIXES = [
  "ANTELOPEJS_",
  "npm_",
  "PNPM_",
  "DMS_",
  "MONGO_",
  "VERIFY_DATABASE_",
  "FORCE_COLOR",
];
const BACKEND_ARGS: Readonly<Record<BackendMode, readonly string[]>> = {
  production: ["project", "start", "-e", ENVIRONMENT, "--refresh-config"],
  dev: ["project", "dev", "-e", ENVIRONMENT],
};
const UNSAFE_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080,
]);
const FIRST_UNPRIVILEGED_PORT = 1024;
const LAST_PORT = 65_535;
const PORT_ATTEMPTS = 50;

/** A password the DMS policy accepts: an uppercase letter, a digit and one of `@$!%*?&`, at least eight characters. */
export function newPassword(): string {
  return `Vr1!${randomBytes(PASSWORD_BYTES).toString("base64url").replace(/[-_]/g, "x")}`;
}

/** A process of the stack in a process group of its own, so a stop ends `ajs` and everything it started. */
class Child {
  readonly #process: ChildProcess;
  #exit: string | null = null;
  #stopping = false;

  constructor(
    readonly name: string,
    readonly log: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) {
    const fd = openSync(log, "a");
    this.#process = spawn(process.execPath, args, {
      cwd: PLAYGROUND,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    closeSync(fd);
    this.#process.once("exit", (code, signal) => {
      this.#exit =
        signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
    });
    this.#process.once("error", (error) => {
      this.#exit ??= `spawn failed: ${error.message}`;
    });
  }

  /** How it ended without a stop, or `null` while it runs or after a stop. */
  lost(): string | null {
    return this.#stopping || this.#exit === null
      ? null
      : `${this.name} ended by itself (${this.#exit})`;
  }

  /** Signals its whole group, synchronously, for the exit backstop. */
  kill(signal: NodeJS.Signals): void {
    const { pid } = this.#process;
    if (pid === undefined || !groupAlive(pid)) return;
    process.kill(-pid, signal);
  }

  /** SIGTERM to the group, SIGKILL after the grace period; resolves once no process of the group is left. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const { pid } = this.#process;
    if (pid === undefined) return;
    this.kill("SIGTERM");
    const deadline = Date.now() + STOP_GRACE_MS;
    while (groupAlive(pid) && Date.now() < deadline) await delay(POLL_MS);
    this.kill("SIGKILL");
    while (groupAlive(pid)) await delay(POLL_MS);
  }

  /** Resolves once `url` answers 2xx; throws with the log's tail when the process ends first or the timeout passes. */
  async ready(url: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.#exit !== null)
        throw new Error(
          `${this.name} ended (${this.#exit}) before ${url} answered:\n${tail(this.log)}`,
        );
      if (await answers(url)) return;
      await delay(POLL_MS);
    }
    throw new Error(
      `${url} did not answer within ${READY_TIMEOUT_MS / 1000} s:\n${tail(this.log)}`,
    );
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function tail(log: string): string {
  return existsSync(log) ? readFileSync(log, "utf8").slice(-LOG_TAIL) : "";
}

function canListen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

function kernelPort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address === null || isText(address)
          ? fail(new Error("the probe server has no TCP port"))
          : done(address.port),
      );
    });
  });
}

/**
 * A free port outside the kernel's ephemeral range, which no outgoing connection takes while the backend restarts,
 * so the API listens on its port again; a port the kernel hands out where the range is unknown or full.
 */
async function freePort(taken: readonly number[]): Promise<number> {
  const range = /^(\d+)\s+(\d+)/.exec(
    existsSync("/proc/sys/net/ipv4/ip_local_port_range")
      ? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8")
      : "",
  );
  if (range !== null) {
    const below = Math.max(Number(range[1]) - FIRST_UNPRIVILEGED_PORT, 0);
    const above = Math.max(LAST_PORT - Number(range[2]), 0);
    for (
      let attempt = 0;
      attempt < PORT_ATTEMPTS && below + above > 0;
      attempt += 1
    ) {
      const index = randomInt(below + above);
      const port =
        index < below
          ? FIRST_UNPRIVILEGED_PORT + index
          : Number(range[2]) + 1 + index - below;
      if (
        !UNSAFE_PORTS.has(port) &&
        !taken.includes(port) &&
        (await canListen(port))
      )
        return port;
    }
  }
  return kernelPort();
}

function cli(packageName: string, script: string): string {
  const require = createRequire(join(PLAYGROUND, "package.json"));
  return join(dirname(require.resolve(`${packageName}/package.json`)), script);
}

function inheritedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return { status: response.status, body: parsed };
  } catch {
    return { status: response.status, body: text };
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** The string an own field of a JSON answer holds, or `undefined`. */
export function stringField(value: unknown, key: string): string | undefined {
  if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
  const found: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  return isText(found) ? found : undefined;
}

class WorkerStack implements Stack {
  readonly repo = REPO;
  readonly apiUrl: string;
  readonly webUrl: string;
  readonly #apiPort: number;
  readonly #webPort: number;
  readonly #worker: number;
  readonly #logs: string;
  readonly #secrets: Env;
  readonly #backstop = (): void => {
    this.#backend?.kill("SIGKILL");
    this.#dashboard?.kill("SIGKILL");
  };
  #env: Env = {};
  #mode: BackendMode = "production";
  #database: string | undefined;
  #databases = 0;
  #starts = 0;
  #mongo: MongoMemoryReplSet | undefined;
  #backend: Child | undefined;
  #dashboard: Child | undefined;

  constructor(worker: number, logs: string, ports: readonly [number, number]) {
    [this.#apiPort, this.#webPort] = ports;
    this.#worker = worker;
    this.#logs = logs;
    this.apiUrl = `http://127.0.0.1:${this.#apiPort}`;
    this.webUrl = `http://127.0.0.1:${this.#webPort}`;
    this.#secrets = Object.fromEntries(
      SECRET_NAMES.map((name) => [
        name,
        randomBytes(SECRET_BYTES).toString("hex"),
      ]),
    );
    mkdirSync(logs, { recursive: true });
    process.once("exit", this.#backstop);
  }

  get env(): Env {
    return this.#env;
  }

  async reset(precondition: Precondition): Promise<Session | undefined> {
    await this.#backend?.stop();
    const previous = this.#database;
    this.#database = this.#nextDatabase();
    this.#env = {};
    this.#mode = precondition.backend;
    await this.#start();
    if (previous !== undefined) await this.#drop(previous);
    return precondition.onboard ? this.#onboard() : undefined;
  }

  async restartBackend(env?: Env): Promise<void> {
    await this.#backend?.stop();
    if (env !== undefined) this.#env = env;
    this.#database ??= this.#nextDatabase();
    await this.#start();
  }

  backendLog(): string {
    return this.#backend === undefined
      ? ""
      : readFileSync(this.#backend.log, "utf8");
  }

  lost(): string | null {
    return this.#backend?.lost() ?? this.#dashboard?.lost() ?? null;
  }

  async stop(): Promise<void> {
    await Promise.all([this.#backend?.stop(), this.#dashboard?.stop()]);
    await this.#mongo?.stop({ doCleanup: true, force: true });
    this.#mongo = undefined;
    process.off("exit", this.#backstop);
  }

  #nextDatabase(): string {
    this.#databases += 1;
    return `e2e_${this.#worker}_${this.#databases}`;
  }

  async #start(): Promise<void> {
    this.#mongo ??= await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: MONGO_VERSION },
    });
    this.#starts += 1;
    const backend = new Child(
      "the backend",
      join(this.#logs, `backend-${this.#starts}.log`),
      [
        cli("@antelopejs/core", "dist/core/cli/index.js"),
        ...BACKEND_ARGS[this.#mode],
      ],
      this.#childEnv({ MONGO_DATABASE: this.#database ?? "", ...this.#env }),
    );
    this.#backend = backend;
    await backend.ready(`${this.apiUrl}/api/onboarding/informations`);
    if (this.#dashboard === undefined || this.#dashboard.lost() !== null) {
      this.#dashboard = new Child(
        "the dashboard",
        join(this.#logs, `dashboard-${this.#starts}.log`),
        [
          cli("@antelopejs/dms-frontend", "dist/index.js"),
          "start",
          "-e",
          ENVIRONMENT,
          "-b",
          this.apiUrl,
          "-p",
          String(this.#webPort),
        ],
        this.#childEnv({}),
      );
      await this.#dashboard.ready(`${this.webUrl}/dms-preview`);
    }
  }

  #childEnv(extra: Env): NodeJS.ProcessEnv {
    return {
      ...inheritedEnv(),
      CI: "1",
      NO_COLOR: "1",
      AJS_NO_UPDATE_CHECK: "1",
      NO_UPDATE_NOTIFIER: "1",
      DMS_PREBUILT: "1",
      PORT: String(this.#apiPort),
      DMS_CLIENT_BASE_URL: this.webUrl,
      DMS_API_BASE_URL: this.apiUrl,
      MONGO_URL: this.#mongo?.getUri() ?? "",
      ...this.#secrets,
      ...extra,
    };
  }

  async #drop(database: string): Promise<void> {
    if (this.#mongo === undefined) return;
    const client = new MongoClient(this.#mongo.getUri());
    try {
      await client.db(database).dropDatabase();
    } finally {
      await client.close();
    }
  }

  async #onboard(): Promise<Session> {
    const password = newPassword();
    const email = `admin@verify.local`;
    const register = await postJson(`${this.apiUrl}/api/onboarding/register`, {
      email,
      password,
      firstName: "Verify",
      lastName: "Admin",
      setupToken: this.#secrets.DMS_SETUP_TOKEN,
      platformName: `Verify ${this.#worker}`,
    });
    if (register.status !== 200)
      throw new Error(
        `POST /api/onboarding/register answered ${register.status}: ${JSON.stringify(register.body)}`,
      );
    const first: unknown = Array.isArray(register.body)
      ? register.body.at(0)
      : undefined;
    const account = {
      email,
      password,
      userId: isText(first) ? first : undefined,
    };
    const login = await postJson(`${this.apiUrl}/api/auth/login`, {
      email,
      password,
    });
    const token = stringField(login.body, "access_token");
    if (login.status !== 200 || token === undefined)
      throw new Error(
        `the administrator's login answered ${login.status}: ${JSON.stringify(login.body)}`,
      );
    return { account, token };
  }
}

/** The stack of one worker: its ports and secrets are picked, nothing is started. */
export async function createStack(
  worker: number,
  logs: string,
): Promise<Stack> {
  const apiPort = await freePort([]);
  const webPort = await freePort([apiPort]);
  return new WorkerStack(worker, logs, [apiPort, webPort]);
}
