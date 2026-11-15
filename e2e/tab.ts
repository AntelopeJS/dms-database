import { setTimeout as delay } from "node:timers/promises";
import {
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import type { Check } from "./ctx.ts";
import type { Account } from "./stack.ts";

/** The width, language and theme of every browser context a journey opens, as `dms-control` set them. */
export const CONTEXT_OPTIONS: BrowserContextOptions = {
  viewport: { width: 1280, height: 900 },
  locale: "en-US",
  colorScheme: "light",
};

/**
 * Holds once the document is parsed and every root the server rendered (`data-server-rendered`) has mounted its Vue
 * app (`__vue_app__`). Before that a click does nothing and a submit posts the form natively.
 */
const HYDRATED = `document.readyState !== "loading" && [...document.querySelectorAll("[data-server-rendered]")].every((root) => "__vue_app__" in root)`;

/** Holds in a hydrated page that has left `/auth` and rendered the content of the page it landed on. */
const LANDED = `${HYDRATED} && !location.pathname.startsWith("/auth") && document.querySelector("[data-dms-page-content]")?.childElementCount > 0`;

const ACTION_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const EXPECT_TIMEOUT_MS = 15_000;
const SETTLE_MS = 400;
const HYDRATION_POLL_MS = 50;
const SHOWS_POLL_MS = 250;
const DETAIL_LENGTH = 300;
const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED";
const REVEAL_TOGGLE_ATTEMPTS = 20;
const REVEAL_TOGGLE_WAIT_MS = 1_500;

type Role = Parameters<Page["getByRole"]>[0];

/**
 * An element found by ARIA role and accessible name, as a user finds it; `within` scopes it to the first match of
 * another one. `level` is accepted and ignored, as `dms-control` ignored it.
 */
export interface Target {
  readonly role: Role;
  readonly name?: string | RegExp;
  readonly exact?: boolean;
  readonly nth?: number;
  readonly level?: number;
  readonly within?: {
    readonly role: Role;
    readonly name?: string | RegExp;
    readonly exact?: boolean;
  };
}

const SHOW_PASSWORD: Target = { role: "button", name: "Show password" };
const HIDE_PASSWORD: Target = { role: "button", name: "Hide password" };

/** How long a check waits, and the negations some checks take. */
export interface Wait {
  readonly timeoutMs?: number;
  readonly hidden?: boolean;
  readonly disabled?: boolean;
  readonly not?: boolean;
}

function locate(page: Page, target: Target): Locator {
  const scope = target.within
    ? page
        .getByRole(target.within.role, {
          name: target.within.name,
          exact: target.within.exact,
        })
        .first()
    : page;
  const found = scope.getByRole(target.role, {
    name: target.name,
    exact: target.exact,
  });
  return target.nth === undefined ? found : found.nth(target.nth);
}

function describeTarget(
  target: Target | NonNullable<Target["within"]>,
): string {
  const nth =
    "nth" in target && target.nth !== undefined ? ` #${target.nth}` : "";
  const own = `${target.role}${target.name === undefined ? "" : ` "${String(target.name)}"`}${nth}`;
  return "within" in target && target.within
    ? `${own} in ${describeTarget(target.within)}`
    : own;
}

function flatten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_LENGTH
    ? `${flat.slice(0, DETAIL_LENGTH)}…`
    : flat;
}

function holdsWithinTimeout(page: Page, condition: string): Promise<boolean> {
  return page
    .waitForFunction(condition, undefined, {
      polling: HYDRATION_POLL_MS,
      timeout: ACTION_TIMEOUT_MS,
    })
    .then(
      () => true,
      () => false,
    );
}

/**
 * Runs an action, then waits for `load`, and then both for hydration and 400 ms. Answers the URLs that failed with
 * `net::ERR_NETWORK_CHANGED` when the page did not hydrate in time, none otherwise.
 */
async function settle(page: Page, act: () => Promise<void>): Promise<string[]> {
  const networkChanged: string[] = [];
  const onFailed = (request: Request): void => {
    if (request.failure()?.errorText === NETWORK_CHANGED)
      networkChanged.push(request.url());
  };
  page.on("requestfailed", onFailed);
  try {
    await act();
    await page
      .waitForLoadState("load", { timeout: NAVIGATION_TIMEOUT_MS })
      .catch(() => undefined);
    const [hydrated] = await Promise.all([
      holdsWithinTimeout(page, HYDRATED),
      delay(SETTLE_MS),
    ]);
    return hydrated ? [] : networkChanged;
  } finally {
    page.off("requestfailed", onFailed);
  }
}

/**
 * A page a journey drives as one account. Each action is a boxed `test.step` named like `admin click button "Login"`,
 * so the report and the trace read as the journey. An action other than `goto` and `reload` first waits until the
 * page hydrated; every action then waits for `load`, hydration and 400 ms. A missing, hidden or disabled target past
 * 15 s throws, which ends the test as a critical step ended the journey. A `goto` or `reload` whose page did not
 * hydrate after a request failed with `net::ERR_NETWORK_CHANGED` runs once more.
 *
 * The checks (`visible`, `enabled`, `shows`, `at`, `count`) never throw: they answer a {@link Check} for
 * `ctx.verify`, so a step's checks settle together and a failed one does not end the journey.
 */
export class Tab {
  readonly #label: string;
  readonly #webUrl: string;
  readonly #accounts: ReadonlyMap<string, Account>;

  constructor(
    readonly page: Page,
    options: {
      readonly label: string;
      readonly webUrl: string;
      readonly accounts: ReadonlyMap<string, Account>;
    },
  ) {
    this.#label = options.label;
    this.#webUrl = options.webUrl;
    this.#accounts = options.accounts;
  }

  /** Opens a path of the dashboard. */
  goto(path: string): Promise<void> {
    return this.#act(`open ${path}`, true, async () => {
      await this.page.goto(new URL(path, this.#webUrl).href, {
        waitUntil: "load",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    });
  }

  reload(): Promise<void> {
    return this.#act("reload", true, async () => {
      await this.page.reload({
        waitUntil: "load",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    });
  }

  click(target: Target): Promise<void> {
    return this.#act(`click ${describeTarget(target)}`, false, () =>
      locate(this.page, target).click({ timeout: ACTION_TIMEOUT_MS }),
    );
  }

  /** Replaces the value of a field. */
  fill(target: Target, value: string): Promise<void> {
    return this.#act(`fill ${describeTarget(target)}`, false, () =>
      locate(this.page, target).fill(value, { timeout: ACTION_TIMEOUT_MS }),
    );
  }

  /** Chooses the option of a native select by its label. */
  select(target: Target, label: string): Promise<void> {
    return this.#act(
      `select ${label} in ${describeTarget(target)}`,
      false,
      async () => {
        await locate(this.page, target).selectOption(
          { label },
          { timeout: ACTION_TIMEOUT_MS },
        );
      },
    );
  }

  /** Presses a key in a target, or on the page. */
  press(key: string, target?: Target): Promise<void> {
    const where = target ? ` in ${describeTarget(target)}` : "";
    return this.#act(`press ${key}${where}`, false, () =>
      target
        ? locate(this.page, target).press(key, { timeout: ACTION_TIMEOUT_MS })
        : this.page.keyboard.press(key),
    );
  }

  /**
   * Signs an account in through the form once it hydrated, as the skill's guard did: opens `/auth`, clicks Show
   * password until the button reads Hide password, fills Email address and Password, clicks Login, and fails the test
   * unless the path leaves `/auth` within 60 s; then waits until the page it landed on rendered its content.
   */
  signIn(account: string): Promise<void> {
    return test.step(
      `${this.#label} signed in as ${account}`,
      async () => {
        const credentials = this.#accounts.get(account);
        if (credentials === undefined)
          throw new Error(
            `${account} signs in and leaves /auth: no account ${account}`,
          );
        await this.goto("/auth");
        for (let attempt = 0; attempt < REVEAL_TOGGLE_ATTEMPTS; attempt += 1) {
          await this.click(SHOW_PASSWORD);
          if (
            (
              await this.visible(HIDE_PASSWORD, {
                timeoutMs: REVEAL_TOGGLE_WAIT_MS,
              })
            ).pass
          )
            break;
        }
        await this.fill(
          { role: "textbox", name: "Email address" },
          credentials.email,
        );
        await this.fill(
          { role: "textbox", name: "Password", exact: true },
          credentials.password,
        );
        await this.click({ role: "button", name: "Login", exact: true });
        const left = await this.at(/^(?!\/auth)/, {
          timeoutMs: NAVIGATION_TIMEOUT_MS,
        });
        if (!left.pass)
          throw new Error(
            `${account} signs in and leaves /auth: still at ${left.detail}`,
          );
        await holdsWithinTimeout(this.page, LANDED);
      },
      { box: true },
    );
  }

  /** The target becomes visible, or with `hidden` hidden or absent, within the timeout. */
  async visible(target: Target, wait: Wait = {}): Promise<Check> {
    const reachedState = await locate(this.page, target)
      .first()
      .waitFor({
        state: wait.hidden ? "hidden" : "visible",
        timeout: wait.timeoutMs ?? EXPECT_TIMEOUT_MS,
      })
      .then(
        () => true,
        () => false,
      );
    return {
      name: `${describeTarget(target)} is ${wait.hidden ? "absent" : "visible"}`,
      pass: reachedState,
      detail: this.page.url(),
    };
  }

  /** The target is enabled, or with `disabled` disabled. */
  async enabled(target: Target, wait: Wait = {}): Promise<Check> {
    const disabled = await locate(this.page, target)
      .first()
      .isDisabled({ timeout: wait.timeoutMs ?? EXPECT_TIMEOUT_MS })
      .catch(() => null);
    const want = wait.disabled === true;
    return {
      name: `${describeTarget(target)} is ${want ? "disabled" : "enabled"}`,
      pass: disabled === want,
      detail: disabled === null ? "not found" : `disabled=${String(disabled)}`,
    };
  }

  /** The body's text matches, or with `not` stops matching, polled every 250 ms until the timeout. */
  async shows(pattern: RegExp, wait: Wait = {}): Promise<Check> {
    const negated = wait.not === true;
    const deadline = Date.now() + (wait.timeoutMs ?? EXPECT_TIMEOUT_MS);
    let text = "";
    while (Date.now() < deadline) {
      text = await this.page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (pattern.test(text) !== negated) break;
      await delay(SHOWS_POLL_MS);
    }
    return {
      name: `page ${negated ? "does not show" : "shows"} ${String(pattern)}`,
      pass: pattern.test(text) !== negated,
      detail: flatten(text),
    };
  }

  /** The path matches within the timeout. */
  async at(pattern: RegExp, wait: Wait = {}): Promise<Check> {
    const matched = await this.page
      .waitForURL((url) => pattern.test(url.pathname), {
        timeout: wait.timeoutMs ?? EXPECT_TIMEOUT_MS,
      })
      .then(
        () => true,
        () => false,
      );
    return {
      name: `path matches ${String(pattern)}`,
      pass: matched,
      detail: new URL(this.page.url()).pathname,
    };
  }

  /** Exactly `expected` elements match. */
  async count(target: Target, expected: number): Promise<Check> {
    const actual = await locate(this.page, target).count();
    return {
      name: `${expected} × ${describeTarget(target)}`,
      pass: actual === expected,
      detail: `found ${actual}`,
    };
  }

  /** The value of a form field. */
  value(target: Target): Promise<string> {
    return locate(this.page, target)
      .first()
      .inputValue({ timeout: EXPECT_TIMEOUT_MS });
  }

  #act(label: string, loads: boolean, run: () => Promise<void>): Promise<void> {
    return test.step(
      `${this.#label} ${label}`,
      async () => {
        if (!loads) await holdsWithinTimeout(this.page, HYDRATED);
        const failed = await settle(this.page, run);
        if (loads && failed.length > 0) await settle(this.page, run);
      },
      { box: true },
    );
  }
}
