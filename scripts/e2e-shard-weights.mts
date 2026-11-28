import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prints the `PWTEST_SHARD_WEIGHTS` value that balances the e2e shards by
 * recorded time, as `node scripts/e2e-shard-weights.mts <results.json> <shards>`,
 * with `results.json` the merged report of a whole-suite run (the
 * `playwright-report` artifact of `e2e-report`). Playwright gives each shard a
 * contiguous run of the listed journeys, as many as its weight; the weights
 * printed are the run lengths whose slowest shard is the shortest. A journey
 * the report does not hold counts as the median journey.
 */

const ROOT = join(import.meta.dirname, "..");

interface Report {
  readonly suites: readonly Suite[];
}

interface Suite {
  readonly specs?: readonly Spec[];
  readonly suites?: readonly Suite[];
}

interface Spec {
  readonly title: string;
  readonly tests: readonly { readonly results?: readonly Result[] }[];
}

interface Result {
  readonly duration: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isListOf<T>(
  value: unknown,
  item: (entry: unknown) => entry is T,
): value is readonly T[] {
  return Array.isArray(value) && value.every(item);
}

function isResult(value: unknown): value is Result {
  return isRecord(value) && typeof value.duration === "number";
}

function isTest(value: unknown): value is Spec["tests"][number] {
  return (
    isRecord(value) &&
    (value.results === undefined || isListOf(value.results, isResult))
  );
}

function isSpec(value: unknown): value is Spec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    isListOf(value.tests, isTest)
  );
}

function isSuite(value: unknown): value is Suite {
  return (
    isRecord(value) &&
    (value.specs === undefined || isListOf(value.specs, isSpec)) &&
    (value.suites === undefined || isListOf(value.suites, isSuite))
  );
}

function parseReport(text: string, origin: string): Report {
  const report: unknown = JSON.parse(text);
  if (!isRecord(report) || !isListOf(report.suites, isSuite)) {
    throw new Error(`${origin}: not a Playwright JSON report`);
  }
  return { suites: report.suites };
}

/** Each journey of a report, in report order, with its longest recorded duration in ms. */
function journeys(report: Report): Map<string, number> {
  const found = new Map<string, number>();
  const walk = (suite: Suite): void => {
    for (const spec of suite.specs ?? []) {
      const durations = spec.tests.flatMap((test) =>
        (test.results ?? []).map((result) => result.duration),
      );
      found.set(spec.title, Math.max(0, ...durations));
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return found;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The lengths of the contiguous runs of `times` whose sums stay at most `limit`. */
function runs(times: readonly number[], limit: number): number[] {
  const lengths: number[] = [];
  let sum = 0;
  let length = 0;
  for (const time of times) {
    if (length > 0 && sum + time > limit) {
      lengths.push(length);
      sum = 0;
      length = 0;
    }
    sum += time;
    length += 1;
  }
  lengths.push(length);
  return lengths;
}

const [reportPath, shardText] = process.argv.slice(2);
const shards = Number(shardText);
if (reportPath === undefined || !Number.isInteger(shards) || shards < 1) {
  throw new Error(
    "usage: node scripts/e2e-shard-weights.mts <results.json> <shards>",
  );
}
const recorded = journeys(
  parseReport(readFileSync(reportPath, "utf8"), reportPath),
);
const listed = [
  ...journeys(
    parseReport(
      execFileSync(
        "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "-c",
          "e2e",
          "--list",
          "--reporter=json",
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, CI: "1" },
        },
      ),
      "playwright --list",
    ),
  ).keys(),
];
const fallback = median([...recorded.values()]);
const times = listed.map((name) => recorded.get(name) ?? fallback);
let low = Math.max(...times);
let high = times.reduce((total, time) => total + time, 0);
while (high - low > 1) {
  const middle = (low + high) / 2;
  if (runs(times, middle).length <= shards) high = middle;
  else low = middle;
}
const lengths = runs(times, high);
while (lengths.length < shards) lengths.push(0);
console.log(lengths.join(":"));
