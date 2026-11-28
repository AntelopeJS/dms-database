import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { mapWithLimit } from "../utils/concurrency";

const WORK_MS = 5;

describe("a fan-out with a limit", () => {
  it("runs at most the limit at once and keeps the items' order, which Promise.all over a map would run all at once", async () => {
    let inFlight = 0;
    let most = 0;
    const results = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await sleep(WORK_MS);
      inFlight -= 1;
      return n * 2;
    });
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
    assert.equal(most, 3);
  });

  it("hands each item its index and answers an empty list for no item", async () => {
    const indexes = await mapWithLimit(["a", "b"], 8, (_, index) =>
      Promise.resolve(index),
    );
    assert.deepEqual(indexes, [0, 1]);
    assert.deepEqual(await mapWithLimit([], 8, () => Promise.resolve(1)), []);
  });

  it("rejects when one call rejects", async () => {
    await assert.rejects(
      mapWithLimit([1, 2], 1, (n) =>
        n === 2 ? Promise.reject(new Error("two")) : Promise.resolve(n),
      ),
      /two/,
    );
  });
});
