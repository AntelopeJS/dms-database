import { appendFileSync } from "node:fs";
import type { Reporter, TestCase } from "@playwright/test/reporter";

/**
 * Reports each journey that failed and then passed on its retry as a `Flaky test` warning annotation and a line of
 * the job summary, the way the shared CI reports a flaky test in the merge queue.
 */
export default class FlakyReporter implements Reporter {
  private readonly flaky: string[] = [];

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: TestCase): void {
    if (test.outcome() === "flaky") {
      this.flaky.push(test.titlePath().filter(Boolean).join(" › "));
    }
  }

  onEnd(): void {
    for (const title of this.flaky) {
      process.stdout.write(
        `::warning title=Flaky test::${title.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}\n`,
      );
    }
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined && this.flaky.length > 0) {
      appendFileSync(
        summary,
        this.flaky.map((title) => `- Flaky test: \`${title}\`\n`).join(""),
      );
    }
  }
}
