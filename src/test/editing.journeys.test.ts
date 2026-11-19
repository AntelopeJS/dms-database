import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  Index,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import {
  isJsonObjectValue,
  type JsonObject,
  type JsonValue,
} from "../types/json";
import { callDatabase, type HttpAnswer } from "./helpers/http";
import { pick } from "./helpers/pick";
import { createOwnerSession, type OwnerSession } from "./ownerSession";

const SHOP = "editing-journeys-shop";
const ID = "eu_ord_10405";
const ORDERS = `filter_schema=is:${SHOP}&filter_table=is:orders`;

@RegisterTable("orders", SHOP)
class EditingJourneysOrder extends Table {
  declare _id: string;
  @Index() declare number: string;
  @Index() declare status: string;
  declare channel: string | null;
  declare total: number;
  declare currency: string;
  declare coupon_id: string | null;
  declare shipping: Record<string, string>;
  @Index() declare created_at: Date;
}

/** Keeps the decorated class referenced: the decorator registers it. */
const TABLES = [EditingJourneysOrder];

function order(index: number) {
  return {
    _id: `eu_ord_${10400 + index}`,
    number: `#${10400 + index}`,
    status: "paid",
    channel: "web",
    total: 100 + index,
    currency: "EUR",
    coupon_id: "cpn_AUTUMN10",
    shipping: { carrier: "UPS", eta: "2026-10-12" },
    created_at: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function shop() {
  const schema = Schema.get(SHOP);
  assert.ok(schema, `${SHOP} is registered`);
  return schema;
}

function put(
  session: OwnerSession,
  id: string,
  body: JsonValue,
): Promise<HttpAnswer> {
  const query = `${ORDERS}&filter_instance=is:eu&connection=own${id ? `&id=${id}` : ""}`;
  return callDatabase(session, "PUT", `/browse/edit?${query}`, body);
}

async function stored(session: OwnerSession): Promise<JsonObject> {
  const answer = await callDatabase(
    session,
    "GET",
    `/browse/get?${ORDERS}&filter_instance=is:eu&id=${ID}`,
  );
  assert.equal(answer.status, 200, answer.text);
  const { body } = answer;
  assert.ok(isJsonObjectValue(body), answer.text);
  return body;
}

async function assertTypedWrites(session: OwnerSession): Promise<void> {
  const number = await put(session, ID, { total: 12.5 });
  assert.deepEqual(
    [number.status, pick(number.body, "total"), pick(number.body, "number")],
    [200, 12.5, "#10405"],
    "a number is stored as a number and the answer is the merged row",
  );
  const twoTexts = await put(session, ID, {
    channel: "kiosk",
    currency: "GBP",
  });
  assert.deepEqual(
    [twoTexts.status, pick(twoTexts.body, "currency")],
    [200, "GBP"],
    "two text fields are written in one call",
  );
  const dateText = await put(session, ID, { created_at: "2026-10-09" });
  const badDate = await put(session, ID, { created_at: "not a date" });
  const boolDate = await put(session, ID, { created_at: true });
  const key = await put(session, ID, { _id: "hacked", _instance: "us" });
  const object = await put(session, ID, { shipping: { carrier: "X" } });
  const cleared = await put(session, ID, { coupon_id: null, channel: null });
  const added = await put(session, ID, { gift: true, note: "hello" });
  const same = await put(session, ID, { currency: "GBP", gift: true });
  const row = await stored(session);
  const hacked = await callDatabase(
    session,
    "GET",
    `/browse/get?${ORDERS}&filter_instance=is:eu&id=hacked`,
  );
  const types = await callDatabase(
    session,
    "GET",
    `/browse/columns?${ORDERS}&filter_instance=is:eu`,
  );
  assert.deepEqual(
    [dateText.status, row.created_at, pick(types.body, "types", "created_at")],
    [200, "2026-10-09T00:00:00.000Z", "date"],
    "a date cell takes a date text and stays a date",
  );
  assert.equal(badDate.status, 400, "a text that is no date is refused");
  assert.match(badDate.text, /Invalid date for 'created_at'/);
  assert.equal(boolDate.status, 400, "a boolean over a date is refused");
  assert.deepEqual(
    [key.status, row._id, row._instance, hacked.status],
    [200, ID, "eu", 404],
    "the primary key and _instance are never rewritten",
  );
  assert.deepEqual(
    [object.status, row.shipping],
    [200, { carrier: "X" }],
    "an object replaces the stored one whole, not merged into it",
  );
  assert.deepEqual(
    [cleared.status, row.coupon_id, row.channel],
    [200, null, null],
    "null clears a cell",
  );
  assert.deepEqual(
    [added.status, row.gift, row.note],
    [200, true, "hello"],
    "a field the row never had is added, as typed",
  );
  assert.deepEqual(
    [same.status, row.currency],
    [200, "GBP"],
    "an unchanged echo is accepted and changes nothing",
  );
}

async function assertRefusals(session: OwnerSession): Promise<void> {
  const everywhere = await callDatabase(
    session,
    "PUT",
    `/browse/edit?${ORDERS}&filter_instance=is:__CROSS_INSTANCE__&id=${ID}&connection=own`,
    { channel: "everywhere" },
  );
  assert.equal(everywhere.status, 400, "an edit across instances is refused");
  assert.match(
    everywhere.text,
    /Editing is disabled when browsing across all instances/,
  );
  assert.notEqual(
    (await stored(session)).channel,
    "everywhere",
    "a refused cross-instance edit still wrote the row",
  );
  const missing = await put(session, "nope", { total: 1 });
  assert.deepEqual(
    [
      (await put(session, "", { total: 1 })).status,
      (await put(session, ID, [1, 2])).status,
      missing.status,
    ],
    [400, 400, 404],
    "a missing id is 400, an array body 400, a missing row 404",
  );
  assert.match(missing.text, /Row not found/);
}

describe("[integration] editing journeys", () => {
  let owner: OwnerSession;

  before(async () => {
    assert.equal(TABLES.length, 1);
    await RegisterSchema(SHOP);
    await shop()
      .createInstance("eu")
      .run()
      .catch(() => undefined);
    await shop()
      .instance("eu")
      .table("orders")
      .insert(Array.from({ length: 8 }, (_, index) => order(index)))
      .run();
    owner = await createOwnerSession("editing-journeys-owner@example.test");
  });

  after(async () => {
    await owner.remove();
    await shop().destroyInstance("eu").run();
  });

  it("the-edit-route-writes-typed-values-and-refuses-the-rest", async () => {
    await assertTypedWrites(owner);
    await assertRefusals(owner);
  });
});
