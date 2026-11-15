import { join } from "node:path";
import { test as base } from "@playwright/test";
import { type Ctx, type Journey, openCtx } from "./ctx.ts";
import { createStack, type Stack } from "./stack.ts";

interface TestFixtures {
  /** Opens the journey's `Ctx` after its precondition; closes its browser contexts and attaches the backend log of a failed test. */
  open: (journey: Journey) => Promise<Ctx>;
}

interface WorkerFixtures {
  stack: Stack;
}

const test = base.extend<TestFixtures, WorkerFixtures>({
  stack: [
    async ({ playwright: _ }, use, workerInfo) => {
      const stack = await createStack(
        workerInfo.workerIndex,
        join(workerInfo.project.outputDir, `stack-${workerInfo.workerIndex}`),
      );
      try {
        await use(stack);
      } finally {
        await stack.stop();
      }
    },
    { scope: "worker" },
  ],
  open: async ({ stack, browser }, use, testInfo) => {
    const opened: Awaited<ReturnType<typeof openCtx>>[] = [];
    await use(async (journey) => {
      const ctx = await openCtx(stack, browser, journey);
      opened.push(ctx);
      return ctx;
    });
    await Promise.all(opened.map((ctx) => ctx.close()));
    if (testInfo.status === testInfo.expectedStatus) return;
    await testInfo.attach("backend.log", {
      body: stack.backendLog(),
      contentType: "text/plain",
    });
    const lost = stack.lost();
    if (lost !== null)
      throw new Error(
        `${lost} during the journey; the backend log is attached`,
      );
  },
});

/**
 * Registers a feature's journeys under a `describe` named after the feature: one test per journey, named by its id so
 * `-g <id>` selects it, with its title and entry point as annotations, its `tag` as the Playwright tag, and `fails`
 * as the reason of an expected failure.
 */
export function defineJourneys(
  feature: string,
  journeys: readonly Journey[],
): void {
  const ids = journeys.map((journey) => journey.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0)
    throw new Error(`${feature} registers ${repeated.join(", ")} twice`);
  test.describe(feature, () => {
    for (const journey of journeys) {
      const annotation = [
        { type: "title", description: journey.title },
        { type: "entry point", description: journey.entryPoint },
      ];
      test(journey.id, { tag: journey.tag, annotation }, async ({ open }) => {
        test.fail(journey.fails !== undefined, journey.fails);
        await journey.run(await open(journey));
      });
    }
  });
}
