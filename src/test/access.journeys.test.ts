import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { pageRoutePath } from "@antelopejs/interface-dms/page";
import type { JsonObject, JsonValue } from "../types/json";
import { callBackend, callDatabase, type HttpAnswer } from "./helpers/http";
import { pick } from "./helpers/pick";
import {
  createMemberWithRole,
  createOwnerSession,
  type OwnerSession,
} from "./ownerSession";

const SCHEMA = "access-journeys";
const SELECTION = `filter_schema=${SCHEMA}&filter_table=products`;
const PAGES = ["overview", "schemas", "diagram", "data", "query"];
const MODULE_PERMISSIONS = [
  "modules.database",
  "modules.database.explore",
  "modules.database.work",
];

const schema = new Schema<{ products: { _id: string; name: string } }>(SCHEMA, {
  products: { fields: { _id: "string", name: "string" }, indexes: {} },
});

function tableQuery(table: string): JsonObject {
  return {
    __cls: "Table",
    stages: [
      { stage: "schema", args: [], options: { id: SCHEMA } },
      { stage: "instance", args: [] },
      { stage: "table", args: [], options: { id: table } },
    ],
  };
}

/** Every read route of the module, with the query string it needs. */
const READS = [
  "/health",
  "/schemas",
  "/overview/schemas",
  "/overview/largest",
  "/overview/recent-queries",
  "/tables/source",
  `/tables/instances?schema=${SCHEMA}`,
  `/browse/list?${SELECTION}`,
  `/browse/count?${SELECTION}`,
  `/browse/columns?${SELECTION}`,
  `/browse/tables?filter_schema=${SCHEMA}`,
  `/browse/references?${SELECTION}&id=sku_desk`,
  `/browse/get?${SELECTION}&id=sku_desk`,
  `/diagram/layout/${SCHEMA}`,
  `/diagram/notes?schema=${SCHEMA}`,
  "/query/saved",
  "/query/history",
  "/query/history/none",
];

/** Every write route of the module, with a body it would accept from the owner. */
const WRITES: readonly [string, string, JsonValue | undefined][] = [
  ["PUT", "/browse/edit", { schema: SCHEMA, table: "products", updates: [] }],
  [
    "POST",
    "/query/execute",
    { query: tableQuery("products"), source: "x", language: "aql" },
  ],
  ["POST", "/query/dry-run", { query: tableQuery("products") }],
  [
    "POST",
    "/query/saved",
    {
      name: "q",
      query: tableQuery("products"),
      source: "x",
      language: "aql",
      shared: true,
    },
  ],
  [
    "PUT",
    "/query/saved/none",
    { name: "q", query: tableQuery("products"), source: "x", language: "aql" },
  ],
  ["DELETE", "/query/saved/none", undefined],
  ["DELETE", "/query/history", undefined],
  ["PUT", `/diagram/layout/${SCHEMA}`, { positions: {} }],
  ["POST", "/diagram/notes", { schema: SCHEMA, text: "x", x: 0, y: 0 }],
  ["PUT", "/diagram/notes/none", { text: "x" }],
  ["DELETE", "/diagram/notes/none", undefined],
];

/** The status every read and write route answers `session`, keyed by method and path. */
async function statusOfEveryRoute(
  session: OwnerSession | null,
): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {};
  for (const path of READS) {
    statuses[`GET ${path}`] = (await callDatabase(session, "GET", path)).status;
  }
  for (const [method, path, body] of WRITES) {
    statuses[`${method} ${path}`] = (
      await callDatabase(session, method, path, body)
    ).status;
  }
  return statuses;
}

function everyRouteAnswers(status: number): Record<string, number> {
  return Object.fromEntries(
    [
      ...READS.map((path) => `GET ${path}`),
      ...WRITES.map(([method, path]) => `${method} ${path}`),
    ].map((route) => [route, status]),
  );
}

/** The length of the list `field` of an answer, or -1 when it holds none. */
function listLength(answer: HttpAnswer, field: string): number {
  const items = pick(answer.body, field);
  return Array.isArray(items) ? items.length : -1;
}

describe("[integration] access journeys", () => {
  let owner: OwnerSession;
  let granted: OwnerSession;

  before(async () => {
    await schema
      .createInstance()
      .run()
      .catch(() => undefined);
    await schema
      .instance()
      .table("products")
      .insert([{ _id: "sku_desk", name: "Standing desk" }])
      .run();
    owner = await createOwnerSession("access-journeys-owner@example.test");
    granted = await createMemberWithRole(
      "access-journeys-member@example.test",
      MODULE_PERMISSIONS,
    );
  });

  after(async () => {
    await owner.remove();
    await granted.remove();
    await schema.instance().table("products").delete().run();
  });

  it("every-route-needs-a-signed-in-session", async () => {
    assert.deepEqual(
      await statusOfEveryRoute(null),
      everyRouteAnswers(401),
      "a route that skips the session check answers a visitor",
    );
    const health = await callDatabase(owner, "GET", "/health");
    assert.equal(
      health.status,
      200,
      `a gate that refuses everyone also refuses the owner: ${health.text}`,
    );
  });

  it("a-member-gets-403-from-every-route-and-writes-nothing", async () => {
    const run = await callDatabase(owner, "POST", "/query/execute", {
      query: tableQuery("products"),
      source: `schemas["${SCHEMA}"].instance().table("products")`,
      language: "aql",
    });
    assert.equal(run.status, 200, run.text);
    const notesPath = `/diagram/notes?schema=${SCHEMA}`;
    const notesBefore = listLength(
      await callDatabase(owner, "GET", notesPath),
      "items",
    );
    const historyBefore = listLength(
      await callDatabase(owner, "GET", "/query/history"),
      "items",
    );

    assert.deepEqual(
      await statusOfEveryRoute(granted),
      everyRouteAnswers(403),
      "a route gated by the module's permissions instead of the owner answers this member",
    );
    assert.equal(
      listLength(await callDatabase(owner, "GET", notesPath), "items"),
      notesBefore,
      "the member's POST /diagram/notes added a note",
    );
    assert.deepEqual(
      [
        historyBefore,
        listLength(await callDatabase(owner, "GET", "/query/history"), "items"),
      ],
      [1, 1],
      "the member's DELETE /query/history cleared the owner's history",
    );
  });

  it("the-owner-only-gate-is-logged-at-start", async () => {
    const layouts: Record<string, [number, number]> = {};
    for (const page of PAGES) {
      const path = pageRoutePath(`/modules/database/${page}`, "/pagelayout");
      layouts[page] = [
        (await callBackend(owner, "GET", path)).status,
        (await callBackend(granted, "GET", path)).status,
      ];
    }
    assert.deepEqual(
      layouts,
      Object.fromEntries(PAGES.map((page) => [page, [200, 403]])),
      "a page outside /modules/database, or one gated by permission rather than owner-only, answers otherwise",
    );
  });
});
