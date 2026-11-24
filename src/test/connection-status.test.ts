import { strict as assert } from "node:assert";
import {
  connectionStatusTrigger,
  createConnectionStatusTrigger,
  probeNamedConnection,
  type Probe,
  type Schedule,
} from "../automation/connectionStatus";
import type { ConnectionProbe } from "../service/health";

type Emitted = Parameters<
  Parameters<typeof connectionStatusTrigger.activate>[1]
>[0];

const OK: ConnectionProbe = { status: "ok", latencyMs: 4, error: null };
const DOWN: ConnectionProbe = {
  status: "down",
  latencyMs: null,
  error: "The database did not answer in time",
};

/** A probe that answers what the test queued, and a scheduler the test steps by hand. */
function harness(start = Date.parse("2026-11-20T10:00:00.000Z")) {
  const answers: ConnectionProbe[] = [];
  const pending: { work: () => void; ms: number }[] = [];
  let clock = start;
  let cancelled = 0;
  let release: (() => void) | undefined;
  let hold = false;
  const probe: Probe = async () => {
    if (hold) await new Promise<void>((resolve) => (release = resolve));
    return answers.shift() ?? OK;
  };
  const schedule: Schedule = (work, ms) => {
    pending.push({ work, ms });
    return () => {
      cancelled++;
    };
  };
  const trigger = createConnectionStatusTrigger(
    probe,
    schedule,
    () => new Date(clock),
  );
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    trigger,
    pending,
    get cancelled() {
      return cancelled;
    },
    queue: (...next: ConnectionProbe[]) => answers.push(...next),
    holdNext: () => {
      hold = true;
    },
    releaseHeld: () => {
      hold = false;
      release?.();
    },
    async step(advanceMs = 60_000) {
      clock += advanceMs;
      const next = pending.shift();
      assert.ok(next, "a probe is scheduled");
      next.work();
      await settle();
    },
    settle,
  };
}

describe("the connection status trigger", () => {
  it("seeds silently on a first probe that answers, then fires down only after failuresBeforeDown failures in a row", async () => {
    const test = harness();
    const events: Emitted[] = [];
    test.queue(OK, DOWN, DOWN);
    await test.trigger.activate({ failuresBeforeDown: 2 }, (e) =>
      events.push(e),
    );
    await test.settle();
    assert.deepEqual(events.slice(), []);
    await test.step();
    assert.deepEqual(events.slice(), [], "one failure is not down yet");
    await test.step();
    assert.deepEqual(
      events.map((event) => ({ ...event, checkedAt: undefined })),
      [
        {
          connection: "own",
          status: "down",
          previousStatus: "ok",
          latencyMs: null,
          error: "The database did not answer in time",
          since: "2026-11-20T10:01:00.000Z",
          checkedAt: undefined,
          deliveryId: "database.connection-status:own:down:2026-11-20T10:01",
        },
      ],
    );
  });

  it("fires down from unknown when the connection is already down at activation", async () => {
    const test = harness();
    const events: Emitted[] = [];
    test.queue(DOWN);
    await test.trigger.activate({ failuresBeforeDown: 1 }, (e) =>
      events.push(e),
    );
    await test.settle();
    assert.deepEqual(
      events.map(({ status, previousStatus }) => ({ status, previousStatus })),
      [{ status: "down", previousStatus: "unknown" }],
    );
  });

  it("fires up once when the connection answers again, and nothing while the status stays", async () => {
    const test = harness();
    const events: Emitted[] = [];
    test.queue(DOWN, DOWN, OK, OK);
    await test.trigger.activate({ failuresBeforeDown: 1 }, (e) =>
      events.push(e),
    );
    await test.settle();
    await test.step();
    await test.step();
    await test.step();
    assert.deepEqual(
      events.map(({ status, previousStatus, latencyMs, error }) => ({
        status,
        previousStatus,
        latencyMs,
        error,
      })),
      [
        {
          status: "down",
          previousStatus: "unknown",
          latencyMs: null,
          error: "The database did not answer in time",
        },
        { status: "ok", previousStatus: "down", latencyMs: 4, error: null },
      ],
    );
  });

  it("fires only the transitions fireOn names", async () => {
    const test = harness();
    const events: Emitted[] = [];
    test.queue(OK, DOWN, OK);
    await test.trigger.activate(
      { failuresBeforeDown: 1, fireOn: ["down"] },
      (e) => events.push(e),
    );
    await test.settle();
    await test.step();
    await test.step();
    assert.deepEqual(
      events.map(({ status }) => status),
      ["down"],
    );
  });
});

describe("the connection status trigger over time", () => {
  it("gives two outages distinct delivery ids and one outage seen twice the same id", async () => {
    const first = harness();
    const second = harness(Date.parse("2026-11-20T10:00:20.000Z"));
    const firstEvents: Emitted[] = [];
    const secondEvents: Emitted[] = [];
    first.queue(DOWN, OK, DOWN);
    second.queue(DOWN);
    await first.trigger.activate({ failuresBeforeDown: 1 }, (e) =>
      firstEvents.push(e),
    );
    await second.trigger.activate({ failuresBeforeDown: 1 }, (e) =>
      secondEvents.push(e),
    );
    await first.settle();
    await first.step();
    await first.step();
    const ids = firstEvents
      .filter(({ status }) => status === "down")
      .map(({ deliveryId }) => deliveryId);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(
      secondEvents[0]?.deliveryId,
      ids[0],
      "another leader seeing the same outage in the same minute",
    );
  });

  it("clamps the interval between probes to 30 seconds and to an hour", async () => {
    const fast = harness();
    await fast.trigger.activate({ intervalSeconds: 1 }, () => undefined);
    await fast.settle();
    const slow = harness();
    await slow.trigger.activate({ intervalSeconds: 999_999 }, () => undefined);
    await slow.settle();
    assert.equal(fast.pending[0]?.ms, 30_000);
    assert.equal(slow.pending[0]?.ms, 3_600_000);
  });

  it("stops on deactivate: the next probe is cancelled and a probe in flight emits nothing", async () => {
    const test = harness();
    const events: Emitted[] = [];
    test.queue(OK);
    const handle = await test.trigger.activate({ failuresBeforeDown: 1 }, (e) =>
      events.push(e),
    );
    await test.settle();
    test.holdNext();
    test.queue(DOWN);
    const step = test.step();
    await test.trigger.deactivate(handle);
    test.releaseHeld();
    await step;
    await test.settle();
    assert.deepEqual(events, []);
    assert.equal(test.pending.length, 0, "no probe scheduled after deactivate");
  });

  it("cancels the scheduled probe on deactivate", async () => {
    const test = harness();
    const handle = await test.trigger.activate({}, () => undefined);
    await test.settle();
    await test.trigger.deactivate(handle);
    assert.equal(test.cancelled, 1);
  });

  it("refuses a connection the project does not list", async () => {
    await assert.rejects(
      connectionStatusTrigger.activate(
        { connection: "nowhere" },
        () => undefined,
      ),
      { message: 'connection-status: unknown connection "nowhere"' },
    );
  });
});

describe("[integration] the connection status probe", () => {
  it("finds the project's own database up", async () => {
    const answer = await probeNamedConnection("own");
    assert.equal(answer.status, "ok");
    assert.equal(answer.error, null);
  });
});
