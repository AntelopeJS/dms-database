import { strict as assert } from "node:assert";
import type { ConnectionAccess } from "@antelopejs/interface-dms/connection-access";
import fc from "fast-check";
import {
  type DmsDatabaseConfig,
  getModuleConfig,
  setModuleConfig,
} from "../config";
import { writeAccess } from "../service/connectionState";
import { writerCalls } from "./writerCalls";

const original = getModuleConfig();
const SEED = Number(process.env.FC_SEED ?? 20261116);
const RUNS = 150;

/** What the configuration writer must receive for one entry the owner did not change. */
interface Kept {
  access?: fc.JsonValue;
}

/** One entry of a project's `externalConnections`, as the file holds it, and what must be written back for it. */
type Neighbour = readonly [
  id: string,
  held: fc.JsonValue | undefined,
  kept: Kept,
];

/** An access change the account allows: `archive` reads only, `erp` can also write. */
const change = fc.constantFrom<{ target: string; access: ConnectionAccess }[]>(
  { target: "erp", access: "read" },
  { target: "erp", access: "read-write" },
  { target: "archive", access: "read" },
);

const connectionId = fc.oneof(
  fc.constantFrom(
    "erp",
    "archive",
    "ledger",
    "crm",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "",
  ),
  fc.string(),
);

const anyJson = fc.jsonValue();

/** An entry a project file can hold, well-formed or not, with the entry the writer must send for it. */
const heldAndKept: fc.Arbitrary<[fc.JsonValue | undefined, Kept]> = fc.oneof(
  fc.constant<[fc.JsonValue | undefined, Kept]>([null, {}]),
  fc.constant<[fc.JsonValue | undefined, Kept]>([undefined, {}]),
  fc.constant<[fc.JsonValue | undefined, Kept]>([{}, {}]),
  anyJson.map<[fc.JsonValue | undefined, Kept]>((access) => [
    { access },
    { access },
  ]),
  fc
    .tuple(anyJson, anyJson)
    .map<[fc.JsonValue | undefined, Kept]>(([access, other]) => [
      { access, other },
      { access },
    ]),
  anyJson.map<[fc.JsonValue | undefined, Kept]>((other) => [{ other }, {}]),
  fc
    .oneof(fc.string(), fc.double(), fc.boolean(), fc.array(anyJson))
    .map<[fc.JsonValue | undefined, Kept]>((value) => [value, {}]),
);

const neighbours = fc.array(
  fc
    .tuple(connectionId, heldAndKept)
    .map<Neighbour>(([id, [held, kept]]) => [id, held, kept]),
  { maxLength: 6 },
);

describe("[property] external access write-back", () => {
  afterEach(() => setModuleConfig(original));

  it("sends the configuration writer the input with only the target's access replaced, whatever the other entries hold, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        neighbours,
        change,
        async (entries, { target, access }) => {
          const externalConnections = Object.fromEntries(
            entries.map(([id, held]) => [id, held]),
          );
          const config: DmsDatabaseConfig = {};
          Reflect.set(config, "externalConnections", externalConnections);
          setModuleConfig({ ...original, ...config });
          const before = writerCalls().length;
          await writeAccess(target, access);
          assert.equal(writerCalls().length, before + 1);
          const expected: [string, Kept][] = entries.map(([id, , kept]) => [
            id,
            kept,
          ]);
          expected.push([target, { access }]);
          assert.deepEqual(writerCalls().at(-1), {
            id: "local",
            entry: {
              config: { externalConnections: Object.fromEntries(expected) },
            },
          });
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
