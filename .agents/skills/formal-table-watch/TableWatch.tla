----------------------------- MODULE TableWatch -----------------------------
(***************************************************************************)
(* The database.table-watch automation trigger of @antelopejs/dms-database *)
(* (src/automation/tableWatch.ts): activate() and its 2 s probe, the pump  *)
(* (pumpFeed and drainFeed) with its one reconnect, and deactivate().      *)
(*                                                                         *)
(* Node runs other callbacks at every await, so each stretch of code       *)
(* between two awaits is one step. A cursor answering a read is a step of  *)
(* its own. A cursor is what openFeed() returns (tableWatch.ts:140-146):   *)
(* a read is iterator.next(), and iterator.return() resolves a read that   *)
(* waits with done at once, then awaits the server's close                 *)
(* (interface-database IterableCursor.return). A cursor counts as closed   *)
(* from that call on.                                                      *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS
  MaxChanges,     \* row changes the table sees in one behaviour
  MaxErrors,      \* reads that fail or end on their own, and reopens that throw
  MaxDeactivates  \* deactivate() calls the automation runtime makes

Cursors == 1..(MaxErrors + 1)
Changes == 0..(MaxChanges - 1)

VARIABLES
  made,        \* changes the table has seen; change c is the (c+1)th
  errors,
  feed,        \* each cursor: "none" (not opened), "open" or "closed"
  pos,         \* the change each cursor delivers next
  rd,          \* each cursor's latest read: "none", "waiting", "change", "done", "error"
  rc,          \* the change that read resolved with
  act,         \* activate(): "probe", "failClosing", "threw", "active"
  pp,          \* the pump: "idle", "read", "threw", "sleep", "closing", "done", "gaveUp"
  on,          \* the cursor whose read the pump awaits
  cur,         \* handle.iterator
  pending,     \* handle.pending still holds cursor 1's first read
  reconnected, \* pumpFeed's reconnected flag
  worked,      \* a cursor reopened since the last caught failure delivered a change
  stopped,     \* handle.stopped
  dp,          \* the first deactivate(): "none", "closing", "returned"
  calls,       \* deactivate() calls so far
  returned,    \* a deactivate() call returned
  emitted,     \* the changes emit() was called with
  twice,       \* emit() was called twice with one change
  late,        \* emit() was called after deactivate() was
  badRead      \* a read started on a closed cursor

vars == <<made, errors, feed, pos, rd, rc, act, pp, on, cur, pending,
          reconnected, worked, stopped, dp, calls, returned, emitted, twice,
          late, badRead>>

Pump == <<pp, on, cur, pending, reconnected, worked>>
Deact == <<stopped, dp, calls, returned>>
Marks == <<emitted, twice, late, badRead>>

(* activate() validated its config, opened cursor 1, started its first    *)
(* read and handed it to handle.pending. The runtime awaits activate() and *)
(* has no handle to deactivate yet.                                        *)
Init ==
  /\ made = 0 /\ errors = 0
  /\ feed = [f \in Cursors |-> IF f = 1 THEN "open" ELSE "none"]  \* tableWatch.ts:318
  /\ pos = [f \in Cursors |-> 0]
  /\ rd = [f \in Cursors |-> IF f = 1 THEN "waiting" ELSE "none"] \* tableWatch.ts:320
  /\ rc = [f \in Cursors |-> 0]
  /\ act = "probe"                                                \* tableWatch.ts:322
  /\ pp = "idle" /\ on = 1
  /\ cur = 1                                                      \* tableWatch.ts:319
  /\ pending = TRUE                                               \* tableWatch.ts:321
  /\ reconnected = FALSE                                          \* tableWatch.ts:204
  /\ worked = FALSE
  /\ stopped = FALSE                                              \* tableWatch.ts:319
  /\ dp = "none" /\ calls = 0 /\ returned = FALSE
  /\ emitted = {} /\ twice = FALSE /\ late = FALSE /\ badRead = FALSE

TypeOK ==
  /\ made \in 0..MaxChanges /\ errors \in 0..MaxErrors
  /\ feed \in [Cursors -> {"none", "open", "closed"}]
  /\ pos \in [Cursors -> 0..MaxChanges]
  /\ rd \in [Cursors -> {"none", "waiting", "change", "done", "error"}]
  /\ rc \in [Cursors -> 0..MaxChanges]
  /\ act \in {"probe", "failClosing", "threw", "active"}
  /\ pp \in {"idle", "read", "threw", "sleep", "closing", "done", "gaveUp"}
  /\ on \in Cursors /\ cur \in Cursors
  /\ dp \in {"none", "closing", "returned"}
  /\ calls \in 0..MaxDeactivates
  /\ emitted \subseteq Changes
  /\ {pending, reconnected, worked, stopped, returned, twice, late, badRead}
       \subseteq BOOLEAN

(* iterator.return() on cursor f: a read that waits resolves with done at *)
(* once (interface-database IterableCursor.return).                       *)
Close(f) ==
  /\ feed' = [feed EXCEPT ![f] = "closed"]
  /\ rd' = IF rd[f] = "waiting" THEN [rd EXCEPT ![f] = "done"] ELSE rd

(* drainFeed takes its next read: handle.pending if set, else a new read  *)
(* on handle.iterator, cursor c after this step, with cursor states fs.   *)
TakeRead(c, fs) ==
  IF pending                                                      \* tableWatch.ts:177
  THEN /\ on' = 1
       /\ pending' = FALSE                                        \* tableWatch.ts:178
       /\ UNCHANGED <<rd, badRead>>
  ELSE /\ on' = c
       /\ pending' = FALSE
       /\ rd' = [rd EXCEPT ![c] = "waiting"]                      \* tableWatch.ts:177
       /\ badRead' = (badRead \/ fs[c] = "closed")

(* ------------------------------ activate -------------------------------- *)

(* The 2 s sleep wins the race, or the first read answered with a change  *)
(* or done. activate() starts the pump and returns the handle; the pump   *)
(* runs to its first await, on handle.pending.                            *)
ProbePasses ==
  /\ act = "probe"
  /\ rd[1] # "error"                                              \* tableWatch.ts:322-329
  /\ act' = "active"                                              \* tableWatch.ts:336
  /\ pp' = "read"                                                 \* tableWatch.ts:335, 205-207
  /\ TakeRead(cur, feed)                                          \* tableWatch.ts:176-179
  /\ UNCHANGED <<made, errors, feed, pos, rc, cur, reconnected, worked, Deact,
                 emitted, twice, late>>

(* The first read rejected inside the probe window: activate() closes     *)
(* cursor 1 and awaits the close.                                         *)
ProbeFails ==
  /\ act = "probe"
  /\ rd[1] = "error"                                              \* tableWatch.ts:325, 329
  /\ act' = "failClosing"
  /\ Close(1)                                                     \* tableWatch.ts:330
  /\ UNCHANGED <<made, errors, pos, rc, Pump, Deact, Marks>>

(* The close resolved: activate() throws.                                 *)
ActivateThrows ==
  /\ act = "failClosing"
  /\ act' = "threw"                                               \* tableWatch.ts:331-333
  /\ UNCHANGED <<made, errors, feed, pos, rd, rc, Pump, Deact, Marks>>

(* ------------------------------ the table ------------------------------- *)

(* A row of the table changes.                                            *)
Change ==
  /\ made < MaxChanges
  /\ made' = made + 1
  /\ UNCHANGED <<errors, feed, pos, rd, rc, act, Pump, Deact, Marks>>

(* A cursor answers its waiting read with the next change made since it   *)
(* opened.                                                                *)
Deliver(f) ==
  /\ rd[f] = "waiting"
  /\ pos[f] < made
  /\ rd' = [rd EXCEPT ![f] = "change"]
  /\ rc' = [rc EXCEPT ![f] = pos[f]]
  /\ pos' = [pos EXCEPT ![f] = @ + 1]
  /\ UNCHANGED <<made, errors, feed, act, Pump, Deact, Marks>>

(* A waiting read rejects (a change-stream error), or resolves with done  *)
(* although nothing closed the cursor (the feed ended on its own).        *)
Fail(f) ==
  /\ rd[f] = "waiting"
  /\ errors < MaxErrors
  /\ errors' = errors + 1
  /\ \E r \in {"error", "done"} : rd' = [rd EXCEPT ![f] = r]
  /\ UNCHANGED <<made, feed, pos, rc, act, Pump, Deact, Marks>>

(* ------------------------------ the pump -------------------------------- *)

(* drainFeed resumes after `await read`. A rejected read throws out of    *)
(* drainFeed. Done returns when stopped, else throws. A change returns    *)
(* when stopped, else is emitted, and the loop takes its next read with   *)
(* no await between.                                                      *)
PumpResume ==
  /\ pp = "read"
  /\ rd[on] \in {"change", "done", "error"}                       \* tableWatch.ts:179
  /\ CASE rd[on] = "error" ->
            /\ pp' = "threw"
            /\ UNCHANGED <<rd, on, pending, worked, Marks>>
       [] rd[on] = "done" ->
            /\ pp' = IF stopped THEN "done" ELSE "threw"          \* tableWatch.ts:180-182
            /\ UNCHANGED <<rd, on, pending, worked, Marks>>
       [] rd[on] = "change" /\ stopped ->                         \* tableWatch.ts:184
            /\ pp' = "done"
            /\ UNCHANGED <<rd, on, pending, worked, Marks>>
       [] rd[on] = "change" /\ ~stopped ->
            /\ emitted' = emitted \cup {rc[on]}                   \* tableWatch.ts:185
            /\ twice' = (twice \/ rc[on] \in emitted)
            /\ late' = (late \/ calls > 0)
            /\ worked' = (worked \/ on > 1)
            /\ pp' = "read"                                       \* tableWatch.ts:176
            /\ TakeRead(cur, feed)                                \* tableWatch.ts:177-179
  /\ UNCHANGED <<made, errors, feed, pos, rc, act, cur, reconnected, Deact>>

(* pumpFeed's catch runs once drainFeed rejected. After the reconnect it  *)
(* gives up with an error log and does not close handle.iterator.         *)
PumpCatch ==
  /\ pp = "threw"                                                 \* tableWatch.ts:209
  /\ CASE stopped ->                                              \* tableWatch.ts:210
            /\ pp' = "done"
            /\ UNCHANGED <<reconnected, worked>>
       [] ~stopped /\ reconnected ->                              \* tableWatch.ts:211
            /\ pp' = "gaveUp"                                     \* tableWatch.ts:212-216
            /\ UNCHANGED <<reconnected, worked>>
       [] ~stopped /\ ~reconnected ->
            /\ pp' = "sleep"                                      \* tableWatch.ts:223
            /\ reconnected' = TRUE                                \* tableWatch.ts:218
            /\ worked' = FALSE
  /\ UNCHANGED <<made, errors, feed, pos, rd, rc, act, on, cur, pending,
                 Deact, Marks>>

(* RECONNECT_DELAY_MS passed: stopped returns, else the pump closes the   *)
(* failed cursor and awaits the close.                                    *)
PumpWake ==
  /\ pp = "sleep"
  /\ IF stopped                                                   \* tableWatch.ts:224
     THEN /\ pp' = "done"
          /\ UNCHANGED <<feed, rd>>
     ELSE /\ pp' = "closing"
          /\ Close(cur)                                           \* tableWatch.ts:225
  /\ UNCHANGED <<made, errors, pos, rc, act, on, cur, pending, reconnected,
                 worked, Deact, Marks>>

(* The close resolved: stopped returns. Else openFeed puts the next       *)
(* cursor in handle.iterator and both loops take a read on it with no     *)
(* await between; or openFeed throws (the schema is gone) and the pump    *)
(* gives up.                                                              *)
PumpReopen ==
  /\ pp = "closing"
  /\ CASE stopped ->                                              \* tableWatch.ts:226
            /\ pp' = "done"
            /\ UNCHANGED <<errors, feed, pos, rd, on, cur, pending, badRead>>
       [] ~stopped ->
            \/ /\ errors < MaxErrors
               /\ errors' = errors + 1
               /\ pp' = "gaveUp"                                  \* tableWatch.ts:229-234
               /\ UNCHANGED <<feed, pos, rd, on, cur, pending, badRead>>
            \/ /\ cur + 1 \in Cursors
               /\ cur' = cur + 1                                  \* tableWatch.ts:228
               /\ feed' = [feed EXCEPT ![cur + 1] = "open"]
               /\ pos' = [pos EXCEPT ![cur + 1] = made]
               /\ pp' = "read"                                    \* tableWatch.ts:205-207
               /\ TakeRead(cur + 1, feed')                        \* tableWatch.ts:176-179
               /\ UNCHANGED errors
  /\ UNCHANGED <<made, rc, act, reconnected, worked, emitted, twice, late,
                 Deact>>

(* ----------------------------- deactivate ------------------------------- *)

(* The runtime calls deactivate(handle) once activate() returned it. A    *)
(* call on a stopped handle returns at once; the first sets stopped and   *)
(* closes handle.iterator.                                                *)
Deactivate ==
  /\ act = "active"
  /\ calls < MaxDeactivates
  /\ calls' = calls + 1
  /\ IF stopped                                                   \* tableWatch.ts:343
     THEN /\ returned' = TRUE
          /\ UNCHANGED <<feed, rd, stopped, dp>>
     ELSE /\ stopped' = TRUE                                      \* tableWatch.ts:344
          /\ dp' = "closing"
          /\ Close(cur)                                           \* tableWatch.ts:345
          /\ UNCHANGED returned
  /\ UNCHANGED <<made, errors, pos, rc, act, Pump, Marks>>

(* The close resolved and deactivate() returns.                           *)
DeactivateReturns ==
  /\ dp = "closing"                                               \* tableWatch.ts:345
  /\ dp' = "returned"
  /\ returned' = TRUE
  /\ UNCHANGED <<made, errors, feed, pos, rd, rc, act, Pump, stopped, calls,
                 Marks>>

Busy ==
  \/ ProbePasses \/ ProbeFails \/ ActivateThrows
  \/ Change
  \/ \E f \in Cursors : Deliver(f) \/ Fail(f)
  \/ PumpResume \/ PumpCatch \/ PumpWake \/ PumpReopen
  \/ Deactivate \/ DeactivateReturns

(* Once nothing can happen, the system stays as it is. This step keeps    *)
(* /statechart from reading the end as a deadlock.                        *)
Settled == ~ENABLED Busy /\ UNCHANGED vars

Next == Busy \/ Settled

Spec == Init /\ [][Next]_vars

(* ------------------------------- rules ---------------------------------- *)

(* No change is emitted once deactivate() was called.                     *)
NoEmitAfterDeactivate == ~late

(* Once deactivate() returned, or activate() threw, no cursor the trigger *)
(* opened is open.                                                        *)
StopClosesFeeds ==
  (returned \/ act = "threw") => \A f \in Cursors : feed[f] # "open"

(* No read starts on a cursor after it was closed.                        *)
NoReadOnClosedFeed == ~badRead

(* At most one cursor of the handle is open at a time.                    *)
OneOpenFeed == \A f, g \in Cursors : feed[f] = "open" /\ feed[g] = "open" => f = g

(* Once the pump gave up, no cursor it opened is open.                    *)
GiveUpCloses == pp = "gaveUp" => \A f \in Cursors : feed[f] # "open"

(* No change is emitted twice.                                            *)
EmitOnce == ~twice

(* The pump gives up only when the cursor it reopened failed before it    *)
(* delivered a change: one reconnect for each failure.                    *)
GiveUpOnlyOnFailedReconnect == pp = "gaveUp" => ~worked

=============================================================================
