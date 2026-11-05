/**
 * Reader's view of TableWatch.tla for /statechart: one region for the
 * trigger, one for the change-feed cursors, one for deactivate().
 */

/**
 * The variables of TableWatch.tla this view reads, as /statechart passes
 * them: a function of cursors is an object keyed from 1, a set an array.
 * @typedef {object} Vars
 * @property {string} act
 * @property {string} pp
 * @property {Record<string, string>} feed
 * @property {string} dp
 * @property {number[]} emitted
 */

const PUMP = new Map([
  ["read", "listening"],
  ["threw", "the feed failed"],
  ["sleep", "waiting 5 s to reconnect"],
  ["closing", "closing the failed feed"],
  ["done", "stopped"],
  ["gaveUp", "gave up"],
]);

const ACTIVATION = new Map([
  ["probe", "activating, 2 s probe"],
  ["failClosing", "probe failed, closing the feed"],
  ["threw", "activation failed"],
]);

/** @param {Vars} v */
function trigger(v) {
  return v.act === "active" ? (PUMP.get(v.pp) ?? v.pp) : (ACTIVATION.get(v.act) ?? v.act);
}

/** @param {Vars} v */
function cursors(v) {
  const open = Object.keys(v.feed).filter((f) => v.feed[f] === "open");
  return open.length === 0 ? "no cursor open" : `cursor ${open.join(" and ")} open`;
}

const DEACTIVATE = new Map([
  ["none", "not called"],
  ["closing", "closing the cursor"],
  ["returned", "returned"],
]);

/**
 * One region each for the trigger, its cursors and deactivate().
 * @param {Vars} v
 * @returns {Record<string, string>}
 */
export function state(v) {
  return {
    Trigger: trigger(v),
    Feed: cursors(v),
    Deactivate: DEACTIVATE.get(v.dp) ?? v.dp,
  };
}

/**
 * @param {Vars} from
 * @param {Vars} to
 */
function resume(from, to) {
  if (to.emitted.length > from.emitted.length) return "emit() fires, the pump reads again";
  return to.pp === "done" ? "the pump sees deactivate() and stops" : "the read fails";
}

/**
 * @param {Vars} to
 */
function caught(to) {
  if (to.pp === "sleep") return "the pump schedules its one reconnect";
  return to.pp === "gaveUp" ? "the pump gives up, logging an error" : "the pump sees deactivate() and stops";
}

/**
 * @param {Vars} to
 */
function reopened(to) {
  if (to.pp === "read") return "the pump opens a new cursor";
  return to.pp === "gaveUp" ? "reopening throws, the pump gives up" : "the pump sees deactivate() and stops";
}

/**
 * The arrow label of one TLC step; `Settled` changes nothing and is hidden.
 * @param {string} action
 * @param {Vars} from
 * @param {Vars} to
 */
export function step(action, from, to) {
  switch (action) {
    case "ProbePasses":
      return "the probe passes, activate() returns";
    case "ProbeFails":
      return "the first read fails in the probe";
    case "ActivateThrows":
      return "activate() throws";
    case "Change":
      return "a row of the table changes";
    case "Deliver":
      return "the cursor answers with a change";
    case "Fail":
      return "the cursor fails";
    case "PumpResume":
      return resume(from, to);
    case "PumpCatch":
      return caught(to);
    case "PumpWake":
      return to.pp === "closing" ? "5 s pass, the pump closes the cursor" : "the pump sees deactivate() and stops";
    case "PumpReopen":
      return reopened(to);
    case "Deactivate":
      return "the runtime calls deactivate()";
    case "DeactivateReturns":
      return "deactivate() returns";
    default:
      return null;
  }
}

export const title = "The database.table-watch trigger of dms-database";
