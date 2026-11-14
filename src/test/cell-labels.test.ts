import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { fetchColumns, resolveSelection } from "../service/browse";
import { OWN_DATABASE } from "../service/database";
import { cellToText } from "../utils/query";

const SCHEMA = "cell-labels";

/** A row whose columns hold one stored shape each; none is declared. */
interface CellRow {
  _id: string;
  text?: string;
  count?: number;
  flag?: boolean;
  tags?: string[];
  meta?: { a: number };
  at?: Date;
  empty?: null;
}

/** An object that holds itself. */
interface Cycle {
  self?: Cycle;
}

const schema = new Schema<{ cells: CellRow }>(SCHEMA, {
  cells: { fields: { _id: "string" }, indexes: {} },
});

describe("the text of a cell", () => {
  it("reads a bigint, a symbol and a function as their own text", () => {
    const shout = () => "hi";
    assert.equal(cellToText(12n), "12");
    assert.equal(cellToText(Symbol("s")), "Symbol(s)");
    assert.equal(cellToText(shout), shout.toString());
  });

  it("reads an object JSON cannot encode as empty, without throwing", () => {
    const cycle: Cycle = {};
    cycle.self = cycle;
    const mute = Object.assign(() => 1, { toString: 1 });
    assert.equal(cellToText(cycle), "");
    assert.equal(cellToText({ big: 1n }), "");
    assert.equal(cellToText(mute), "");
  });
});

describe("[integration] the type a sampled cell gives its column", () => {
  after(async () => {
    await schema.instance().table("cells").delete().run();
  });

  it("names each stored shape", async () => {
    await schema
      .instance()
      .table("cells")
      .insert({
        _id: "c1",
        text: "x",
        count: 2,
        flag: true,
        tags: ["a"],
        meta: { a: 1 },
        at: new Date("2026-11-12T00:00:00.000Z"),
        empty: null,
      })
      .run();
    const meta = await fetchColumns(
      OWN_DATABASE,
      resolveSelection(`is:${SCHEMA}`, undefined, "is:cells"),
    );
    assert.deepEqual(Object.fromEntries(Object.entries(meta.types)), {
      _id: "string",
      text: "string",
      count: "number",
      flag: "boolean",
      tags: "array",
      meta: "object",
      at: "date",
      empty: "null",
      _instance: "null",
    });
  });
});
