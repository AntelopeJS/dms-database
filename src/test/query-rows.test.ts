import { strict as assert } from "node:assert";
import { Query, Schema } from "@antelopejs/interface-database";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseQueryController } from "../routes/query";
import type { JsonObject } from "../types/json";
import { encode } from "./stagedWire";

const SCHEMA = "query-rows-qa";
const USER = Object.assign(new User(), { _id: "query-rows-user" });
const schema = new Schema<{ items: { _id: string } }>(SCHEMA, {
  items: { fields: { _id: "string" }, indexes: {} },
});

/** What a store can hand back for a query, JSON or not. */
type StoreAnswer =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  | JsonObject
  | StoreAnswer[]
  | (() => string);

/** The rows the console answers when the store answers its count with `answer`. */
async function rowsFor(answer: StoreAnswer) {
  const originalRun = Object.getOwnPropertyDescriptor(Query.prototype, "run");
  assert.ok(originalRun);
  Query.prototype.run = async function () {
    const isConsoleCount =
      this.stages.some(
        (stage) => stage.stage === "schema" && stage.options?.id === SCHEMA,
      ) && this.stages.some((stage) => stage.stage === "count");
    if (isConsoleCount) return answer;
    Object.defineProperty(this, "run", originalRun);
    const stored: unknown = await this.run();
    return stored;
  };
  try {
    const result = await new DatabaseQueryController().execute(USER, {
      query: encode(schema.instance().table("items").count()),
      source: "count",
      language: "aql",
    });
    return result.rows;
  } finally {
    Object.defineProperty(Query.prototype, "run", originalRun);
  }
}

describe("[integration] query console rows", () => {
  it("shows an object as a row, a scalar or a list as its value", async () => {
    assert.deepEqual(await rowsFor({ a: 1 }), [{ a: 1 }]);
    assert.deepEqual(await rowsFor("x"), [{ value: "x" }]);
    assert.deepEqual(await rowsFor(3), [{ value: 3 }]);
    assert.deepEqual(await rowsFor(true), [{ value: true }]);
    assert.deepEqual(await rowsFor(null), [{ value: null }]);
    assert.deepEqual(await rowsFor([1, { a: 1 }, [2]]), [
      { value: 1 },
      { a: 1 },
      { value: [2] },
    ]);
    assert.deepEqual(await rowsFor(undefined), []);
  });

  it("shows an answer with no JSON form as an empty row", async () => {
    const shout = () => "hi";
    assert.deepEqual(await rowsFor(1n), [{}]);
    assert.deepEqual(await rowsFor(Symbol("s")), [{}]);
    assert.deepEqual(await rowsFor(shout), [{}]);
    assert.deepEqual(await rowsFor([1n, undefined]), [{}, {}]);
  });
});
