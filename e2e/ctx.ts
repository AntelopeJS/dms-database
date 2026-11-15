import {
  type Browser,
  type BrowserContext,
  expect,
  test,
} from "@playwright/test";
import {
  type Account,
  type BackendMode,
  type Env,
  newPassword,
  type Stack,
  stringField,
} from "./stack.ts";
import { CONTEXT_OPTIONS, Tab } from "./tab.ts";

/** One observation of a step: what is checked, whether it holds and what was seen. */
export interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** What the backend answered: `status` is `null` and `error` set when it did not answer. */
export interface Answer {
  readonly status: number | null;
  readonly body: unknown;
  readonly error: string | null;
}

/** A call of the backend as an account, `admin` by default, or as nobody with `anon`. */
export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly as?: string;
}

/**
 * A scripted journey, one Playwright test named by its `id`. It starts on a new database with the administrator
 * onboarded, unless `database` is `"shared"` (the stack is left as it is) or `onboard` is `false`. `backend: "dev"`
 * runs its backend in development mode, `tag` is the Playwright tag that selects it, and `fails` names the product
 * finding that makes it fail today, which marks it an expected failure.
 */
export interface Journey {
  readonly id: string;
  readonly title: string;
  readonly entryPoint: string;
  readonly database?: string;
  readonly onboard?: boolean;
  readonly backend?: string;
  readonly tag?: string;
  readonly fails?: string;
  run(ctx: Ctx): Promise<void>;
}

/** What a journey drives: steps of checks, tabs per account, the API per account and the backend's restarts. */
export interface Ctx {
  /**
   * One `test.step` named `label`: every check is awaited together, then each is an `expect.soft`, so a failed one
   * does not end the journey; with `critical` a failed one ends the test after the step.
   */
  verify(
    label: string,
    checks: readonly (Check | Promise<Check>)[],
    options?: { readonly critical?: boolean },
  ): Promise<void>;
  /** A new page as `account` (`anon` for nobody), in that account's own browser context; not signed in. */
  tab(account?: string, label?: string): Promise<Tab>;
  /** A boxed step: the request with the account's bearer token, logged in again once on a 401; never throws on a status. */
  api(label: string, request: ApiRequest): Promise<Answer>;
  /** Stops and starts the backend on the same database; `env` replaces the overlay, kept as it is without one. */
  restartBackend(env?: Env): Promise<void>;
  /** The overlay the running backend started with. */
  readonly backendEnv: Env;
  /** The checkout, for the journeys that pack the module or read its files. */
  readonly repo: string;
  /** The log of the backend's latest start. */
  backendLog(): string;
  /** A password the DMS policy accepts. */
  password(): string;
  /** An account the journey created, such as an invited member, for `tab` and `api`. */
  addAccount(name: string, account: Account): void;
}

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 30_000;
const UNAUTHORIZED = 401;

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined ? String(error) : String(error.cause);
}

async function send(
  url: string,
  request: ApiRequest,
  token: string | undefined,
): Promise<Answer> {
  const headers = new Headers({ accept: "application/json" });
  if (request.body !== undefined)
    headers.set("content-type", "application/json");
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    try {
      const body: unknown = JSON.parse(text);
      return { status: response.status, body, error: null };
    } catch {
      return { status: response.status, body: text, error: null };
    }
  } catch (error) {
    return { status: null, body: null, error: describeError(error) };
  }
}

/** The backend mode a journey asks for; anything but `"dev"` or none is a mistake in the journey. */
function backendMode(journey: Pick<Journey, "id" | "backend">): BackendMode {
  if (journey.backend === undefined) return "production";
  if (journey.backend === "dev") return "dev";
  throw new Error(
    `${journey.id} asks for a ${journey.backend} backend; journeys run on a production or a dev one`,
  );
}

class JourneyCtx implements Ctx {
  readonly #stack: Stack;
  readonly #browser: Browser;
  readonly #accounts = new Map<string, Account>();
  readonly #tokens = new Map<string, string>();
  readonly #contexts = new Map<string, BrowserContext>();

  constructor(stack: Stack, browser: Browser) {
    this.#stack = stack;
    this.#browser = browser;
  }

  get backendEnv(): Env {
    return this.#stack.env;
  }

  get repo(): string {
    return this.#stack.repo;
  }

  async verify(
    label: string,
    checks: readonly (Check | Promise<Check>)[],
    options: { readonly critical?: boolean } = {},
  ): Promise<void> {
    const passed = await test.step(label, async () => {
      const settled = await Promise.all(
        checks.map((check) => Promise.resolve(check)),
      );
      for (const check of settled)
        expect.soft(check.pass, `${check.name}: ${check.detail}`).toBe(true);
      return settled.every((check) => check.pass);
    });
    if (!passed && options.critical === true)
      throw new Error(`critical step "${label}" failed`);
  }

  async tab(account = "admin", label = account): Promise<Tab> {
    let context = this.#contexts.get(account);
    if (context === undefined) {
      context = await this.#browser.newContext(CONTEXT_OPTIONS);
      context.setDefaultTimeout(PAGE_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
      this.#contexts.set(account, context);
    }
    return new Tab(await context.newPage(), {
      label,
      webUrl: this.#stack.webUrl,
      accounts: this.#accounts,
    });
  }

  api(label: string, request: ApiRequest): Promise<Answer> {
    return test.step(
      `api ${label}`,
      async () => {
        const as = request.as ?? "admin";
        const url = `${this.#stack.apiUrl}${request.path}`;
        if (as === "anon") return send(url, request, undefined);
        if (!this.#tokens.has(as)) await this.#login(as);
        const first = await send(url, request, this.#tokens.get(as));
        if (first.status !== UNAUTHORIZED) return first;
        await this.#login(as);
        return send(url, request, this.#tokens.get(as));
      },
      { box: true },
    );
  }

  async restartBackend(env?: Env): Promise<void> {
    await test.step(
      "restart the backend",
      () => this.#stack.restartBackend(env),
      { box: true },
    );
  }

  backendLog(): string {
    return this.#stack.backendLog();
  }

  password(): string {
    return newPassword();
  }

  addAccount(name: string, account: Account): void {
    this.#accounts.set(name, account);
  }

  /** Seeds the administrator a reset onboarded, with the token its login answered. */
  admit(name: string, account: Account, token: string): void {
    this.#accounts.set(name, account);
    this.#tokens.set(name, token);
  }

  /** Closes every browser context the journey opened. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.#contexts.values()].map((context) =>
        context.close().catch(() => undefined),
      ),
    );
  }

  async #login(account: string): Promise<void> {
    const credentials = this.#accounts.get(account);
    if (credentials === undefined)
      throw new Error(
        `No account ${account} in the journey; onboard it or add it with ctx.addAccount`,
      );
    const answer = await send(
      `${this.#stack.apiUrl}/api/auth/login`,
      {
        method: "POST",
        path: "/api/auth/login",
        body: { email: credentials.email, password: credentials.password },
      },
      undefined,
    );
    const token = stringField(answer.body, "access_token");
    if (
      answer.status !== null &&
      answer.status >= 200 &&
      answer.status < 300 &&
      token !== undefined
    )
      this.#tokens.set(account, token);
  }
}

/**
 * Brings a journey's precondition into being, then answers its `Ctx`: unless the journey shares the database, the
 * stack resets onto a new one and, unless `onboard` is `false`, the administrator `admin` is onboarded.
 */
export async function openCtx(
  stack: Stack,
  browser: Browser,
  journey: Journey,
): Promise<JourneyCtx> {
  const ctx = new JourneyCtx(stack, browser);
  if (journey.database === "shared") return ctx;
  if (journey.database !== undefined)
    throw new Error(
      `${journey.id} asks for a ${journey.database} database; a journey shares the database or gets a new one`,
    );
  const session = await stack.reset({
    onboard: journey.onboard !== false,
    backend: backendMode(journey),
  });
  if (session !== undefined) ctx.admit("admin", session.account, session.token);
  return ctx;
}
