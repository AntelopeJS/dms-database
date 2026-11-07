/**
 * What the helpers that wait for a page to settle use of Playwright beyond the other declarations: the end of the
 * page's requests and the kind of each.
 */
declare module "playwright-core" {
  interface Request {
    resourceType(): string;
  }

  interface Page {
    on(event: "requestfinished" | "requestfailed", listener: (request: Request) => void): Page;
    off(event: "request" | "requestfinished" | "requestfailed", listener: (request: Request) => void): Page;
  }
}
