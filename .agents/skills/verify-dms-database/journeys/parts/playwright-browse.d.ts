/**
 * The parts of playwright-core's API the data browser journeys use beyond `../../playwright-core.d.ts`: nth and
 * filtered locators, bulk reads of a locator, the keyboard modifiers, a reload, and requests seen or answered by
 * the page. Declared here so the shared declarations stay the foundation's.
 */
declare module "playwright-core" {
  interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface Locator {
    nth(index: number): Locator;
    filter(options: { has?: Locator; hasText?: string | RegExp }): Locator;
    locator(selector: string): Locator;
    allInnerTexts(): Promise<string[]>;
    evaluateAll<R>(callback: (elements: HTMLElement[]) => R): Promise<R>;
    isDisabled(options?: { timeout?: number }): Promise<boolean>;
    boundingBox(): Promise<Box | null>;
    click(options?: { timeout?: number; modifiers?: ("Control" | "Shift" | "Alt" | "Meta")[] }): Promise<void>;
    dblclick(options?: { timeout?: number; modifiers?: ("Control" | "Shift" | "Alt" | "Meta")[] }): Promise<void>;
  }

  interface Keyboard {
    down(key: string): Promise<void>;
    up(key: string): Promise<void>;
  }

  interface Request {
    url(): string;
    method(): string;
    postData(): string | null;
  }

  interface Route {
    request(): Request;
    abort(): Promise<void>;
    fulfill(options: { status: number; contentType?: string; body?: string }): Promise<void>;
  }

  interface Page {
    reload(): Promise<object | null>;
    on(event: "request", listener: (request: Request) => void): Page;
    unroute(url: string): Promise<void>;
  }
}
