/**
 * What the schemas and diagram journeys use of Playwright beyond `playwright-core.d.ts`: the mouse, scoped
 * locators and element boxes.
 */
declare module "playwright-core" {
  interface Mouse {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    dblclick(x: number, y: number): Promise<void>;
    click(x: number, y: number): Promise<void>;
  }

  interface Locator {
    locator(selector: string): Locator;
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    nth(index: number): Locator;
    filter(options: { hasText?: string | RegExp }): Locator;
    isDisabled(options?: Timeout): Promise<boolean>;
    hover(options?: Timeout): Promise<void>;
  }

  interface Page {
    mouse: Mouse;
    reload(): Promise<object | null>;
    evaluate<R, A>(callback: (argument: A) => R, argument?: A): Promise<R>;
    waitForFunction(callback: () => boolean, options?: Timeout): Promise<void>;
    viewportSize(): { width: number; height: number } | null;
  }
}
