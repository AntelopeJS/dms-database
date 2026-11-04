import { strict as assert } from "node:assert";
import { HTTPResult } from "@antelopejs/interface-api";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { QueryHistoryModel, SavedQueryModel } from "../db";
import { DatabaseQueryController } from "../routes/query";
import { bodyText, refusal } from "./refusal";
import { encode } from "./stagedWire";

const SCHEMA = "saved-queries-qa";
const OWNER = Object.assign(new User(), { _id: "saved-queries-owner" });
const PEER = Object.assign(new User(), { _id: "saved-queries-peer" });

const schema = new Schema<{ items: { _id: string; name: string } }>(SCHEMA, {
  items: { fields: { _id: "string", name: "string" }, indexes: {} },
});
const QUERY = encode(schema.instance().table("items"));

type SaveBody = Parameters<DatabaseQueryController["createSaved"]>[1];

const SAVE: SaveBody = {
  name: "all items",
  description: "every item",
  query: QUERY,
  source: "items",
  language: "aql",
  shared: false,
};

async function clearAll(): Promise<void> {
  for (const user of [OWNER, PEER]) {
    for (const row of await GetModel(SavedQueryModel).listForUser(user._id)) {
      await GetModel(SavedQueryModel).delete(row._id);
    }
    await GetModel(QueryHistoryModel).clearForUser(user._id);
  }
}

function withCleanTables(): void {
  before(clearAll);
  after(clearAll);
}

describe("[integration] saved queries", () => {
  withCleanTables();

  it("saves a query, lists it for its owner and keeps what it was given", async () => {
    const controller = new DatabaseQueryController();
    const saved = await controller.createSaved(OWNER, SAVE);
    assert.equal(saved.userId, OWNER._id);
    assert.equal(saved.name, "all items");
    assert.equal(saved.description, "every item");
    assert.deepEqual(saved.query, QUERY);
    assert.equal(saved.source, "items");
    assert.equal(saved.language, "aql");
    assert.equal(saved.shared, false);

    const bare = await controller.createSaved(OWNER, {
      ...SAVE,
      description: 5,
      shared: "yes",
    });
    assert.equal(bare.description, "");
    assert.equal(bare.shared, false, "only true shares a query");

    const mine = await controller.listSaved(OWNER, undefined);
    assert.deepEqual(
      mine.items.map((item) => item.id).sort(),
      [saved.id, bare.id].sort(),
    );
    assert.deepEqual(await controller.listSaved(PEER, "me"), { items: [] });
    assert.deepEqual(await controller.listSaved(PEER, ["shared"]), {
      items: [],
    });
  });

  it("lists the shared queries of every user under the shared scope", async () => {
    const controller = new DatabaseQueryController();
    const shared = await controller.createSaved(OWNER, {
      ...SAVE,
      name: "shared items",
      shared: true,
    });
    const listed = await controller.listSaved(PEER, "shared");
    assert.deepEqual(
      listed.items.map((item) => item.id),
      [shared.id],
    );
    assert.equal(listed.items[0]?.shared, true);
    assert.equal(
      (await controller.listSaved(PEER, "anything else")).items.length,
      0,
    );
  });
});

describe("[integration] refused saves", () => {
  withCleanTables();

  it("refuses a save whose query, name, source or language is invalid", async () => {
    const controller = new DatabaseQueryController();
    const save = (body: SaveBody) =>
      refusal(controller.createSaved(OWNER, body));
    const objectOnly = {
      status: 400,
      message: "Expected query to be an object",
    };
    assert.deepEqual(await save({ ...SAVE, query: undefined }), objectOnly);
    assert.deepEqual(await save({ ...SAVE, query: [] }), objectOnly);
    assert.deepEqual(await save({ ...SAVE, query: "items" }), objectOnly);
    const nonEmpty = { status: 400, message: "Expected non-empty string" };
    assert.deepEqual(await save({ ...SAVE, name: "" }), nonEmpty);
    assert.deepEqual(await save({ ...SAVE, name: 3 }), nonEmpty);
    assert.deepEqual(await save({ ...SAVE, source: undefined }), nonEmpty);
    const language = { status: 400, message: "Unsupported query language" };
    assert.deepEqual(await save({ ...SAVE, language: "sql" }), language);
    assert.deepEqual(await save({ ...SAVE, language: undefined }), language);
    assert.deepEqual(
      await save({ ...SAVE, name: "", source: "", language: "sql" }),
      nonEmpty,
      "the name is checked before the source and the language",
    );
    assert.deepEqual(
      await save({ ...SAVE, source: "", language: "sql" }),
      nonEmpty,
      "the source is checked before the language",
    );
    assert.deepEqual(
      await save({ ...SAVE, query: undefined, name: "" }),
      objectOnly,
      "the query is checked before the name",
    );
  });

  it("answers a body that is not a runnable query like a failed run", async () => {
    const controller = new DatabaseQueryController();
    await assert.rejects(
      controller.createSaved(OWNER, {
        ...SAVE,
        query: { __cls: "NoSuchClass", stages: [] },
      }),
      (error: HTTPResult) => {
        assert.equal(error.getStatus(), 400);
        assert.match(bodyText(error), /^\{"message":"Malformed query/);
        return true;
      },
    );
    await assert.rejects(
      controller.createSaved(OWNER, { ...SAVE, query: { value: 1 } }),
      (error: HTTPResult) => {
        assert.equal(error.getStatus(), 400);
        assert.match(bodyText(error), /Query must resolve to a runnable/);
        return true;
      },
    );
  });
});

describe("[integration] saved query ownership", () => {
  withCleanTables();

  it("updates a query for its owner only", async () => {
    const controller = new DatabaseQueryController();
    const saved = await controller.createSaved(OWNER, SAVE);
    const updated = await controller.updateSaved(OWNER, saved.id, {
      ...SAVE,
      name: "renamed",
      shared: true,
    });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.name, "renamed");
    assert.equal(updated.shared, true);
    assert.equal(updated.createdAt, saved.createdAt);
    const listed = await controller.listSaved(OWNER, "shared");
    assert.ok(listed.items.some((item) => item.name === "renamed"));

    const notFound = { status: 404, message: "Saved query not found" };
    assert.deepEqual(
      await refusal(controller.updateSaved(PEER, saved.id, SAVE)),
      notFound,
    );
    assert.deepEqual(
      await refusal(controller.updateSaved(OWNER, "missing", SAVE)),
      notFound,
    );
    const nonEmpty = { status: 400, message: "Expected non-empty string" };
    assert.deepEqual(
      await refusal(controller.updateSaved(OWNER, "", SAVE)),
      nonEmpty,
    );
    assert.deepEqual(
      await refusal(controller.updateSaved(OWNER, "", { ...SAVE, name: "" })),
      nonEmpty,
    );
    assert.deepEqual(
      await refusal(controller.updateSaved(OWNER, "", { ...SAVE, query: 1 })),
      { status: 400, message: "Expected query to be an object" },
      "the body is checked before the id",
    );
  });

  it("deletes a query for its owner only", async () => {
    const controller = new DatabaseQueryController();
    const saved = await controller.createSaved(OWNER, SAVE);
    assert.deepEqual(await refusal(controller.deleteSaved(PEER, saved.id)), {
      status: 404,
      message: "Saved query not found",
    });
    assert.deepEqual(await controller.deleteSaved(OWNER, saved.id), {
      success: true,
    });
    assert.deepEqual(await refusal(controller.deleteSaved(OWNER, saved.id)), {
      status: 404,
      message: "Saved query not found",
    });
    assert.deepEqual(await refusal(controller.deleteSaved(OWNER, undefined)), {
      status: 400,
      message: "Expected non-empty string",
    });
  });
});

describe("[integration] query history routes", () => {
  withCleanTables();

  it("serves a user's own history entries, paged, and refuses another's", async () => {
    const controller = new DatabaseQueryController();
    const history = GetModel(QueryHistoryModel);
    for (let minute = 0; minute < 4; minute++) {
      await history.addAndPrune({
        userId: OWNER._id,
        executedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
        query: QUERY,
        source: `run ${minute}`,
        language: "aql",
        durationMs: 1,
        rowCount: minute,
      });
    }
    const page = await controller.listHistory(OWNER, "2", "1");
    assert.equal(page.total, 4);
    assert.deepEqual(
      page.items.map((item) => item.source),
      ["run 2", "run 1"],
    );
    assert.equal(page.items[0]?.status, "ok");
    assert.equal(page.items[0]?.mutation, false);
    const fallback = await controller.listHistory(OWNER, "many", "-5");
    assert.equal(fallback.items.length, 4);
    assert.equal(
      (await controller.listHistory(OWNER, "0", "0")).items.length,
      1,
    );
    assert.equal(
      (await controller.listHistory(OWNER, ["2"], undefined)).items.length,
      4,
    );

    const [newest] = page.items;
    assert.ok(newest);
    const entry = await controller.getHistoryEntry(OWNER, newest.id);
    assert.equal(entry.source, "run 2");
    assert.deepEqual(
      await refusal(controller.getHistoryEntry(PEER, newest.id)),
      { status: 404, message: "History entry not found" },
    );
    assert.deepEqual(
      await refusal(controller.getHistoryEntry(OWNER, "missing")),
      { status: 404, message: "History entry not found" },
    );
    assert.deepEqual(await refusal(controller.getHistoryEntry(OWNER, "")), {
      status: 400,
      message: "Expected non-empty string",
    });
    assert.deepEqual(await controller.clearHistory(OWNER), { success: true });
    assert.equal(
      (await controller.listHistory(OWNER, undefined, undefined)).total,
      0,
    );
  });
});
