import { strict as assert } from "node:assert";
import {
  column,
  type DataApi,
  METRICS,
  READINGS,
  rowsOf,
  SHOP,
  withDataFixture,
} from "./dataJourneys";
import { callDatabase } from "./helpers/http";
import { pick } from "./helpers/pick";
import { createMemberSession } from "./ownerSession";
import { LOADED_HOST_TIMEOUT_MS } from "./helpers/timeouts";

async function assertInstancePicker(api: DataApi): Promise<void> {
  const instances = async (query: string) => {
    const answer = await api.get(`/tables/instances?${query}`);
    return {
      status: answer.status,
      instances: pick(answer.body, "instances"),
      total: pick(answer.body, "total"),
    };
  };
  assert.deepEqual(
    {
      all: await instances(`schema=${SHOP}`),
      searched: await instances(`schema=${SHOP}&search=US`),
      both: await instances(`schema=${SHOP}&search=u`),
      none: await instances(`schema=${SHOP}&search=zzz`),
      limited: await instances(`schema=${SHOP}&limit=1`),
      zero: await instances(`schema=${SHOP}&limit=0`),
      metrics: await instances(`schema=${METRICS}`),
    },
    {
      all: { status: 200, instances: ["eu", "us"], total: 2 },
      searched: { status: 200, instances: ["us"], total: 1 },
      both: { status: 200, instances: ["eu", "us"], total: 2 },
      none: { status: 200, instances: [], total: 0 },
      limited: { status: 200, instances: ["eu"], total: 2 },
      zero: { status: 200, instances: ["eu"], total: 2 },
      metrics: { status: 200, instances: [], total: 0 },
    },
    "a case-sensitive search, a limit that also cuts the total, an unsorted list or a limit of 0 kept at 0",
  );
  assert.deepEqual(
    [
      (await api.get("/tables/instances")).status,
      (await api.get("/tables/instances?schema=nowhere")).status,
    ],
    [400, 404],
    "a missing schema answered 200, or an unknown one read as empty",
  );
}

async function assertListClamps(api: DataApi): Promise<void> {
  const page = async (params: Record<string, string | number>) => {
    const answer = await api.browse("list", READINGS, params);
    return {
      rows: rowsOf(answer).length,
      limit: pick(answer.body, "limit"),
    };
  };
  const base = await api.browse("list", READINGS);
  assert.deepEqual(
    {
      rows: rowsOf(base).length,
      limit: pick(base.body, "limit"),
      offset: pick(base.body, "offset"),
      total: pick(base.body, "total"),
      primaryKey: pick(base.body, "primaryKey"),
    },
    { rows: 25, limit: 25, offset: 0, total: 1250, primaryKey: "_id" },
    "no limit answers 25 rows, offset 0, the exact total and the primary key",
  );
  assert.deepEqual(
    {
      500: await page({ limit: 500 }),
      200: await page({ limit: 200 }),
      199: await page({ limit: 199 }),
      201: await page({ limit: 201 }),
      0: await page({ limit: 0 }),
      "-7": await page({ limit: -7 }),
      abc: await page({ limit: "abc" }),
    },
    {
      500: { rows: 200, limit: 200 },
      200: { rows: 200, limit: 200 },
      199: { rows: 199, limit: 199 },
      201: { rows: 200, limit: 200 },
      0: { rows: 1, limit: 1 },
      "-7": { rows: 1, limit: 1 },
      abc: { rows: 25, limit: 25 },
    },
    "limit is clamped to 1..200 and falls back to 25 when it is no number",
  );
  const negativeOffset = await api.browse("list", READINGS, {
    offset: -3,
    limit: 5,
    sortKey: "seq",
  });
  assert.deepEqual(
    {
      offset: pick(negativeOffset.body, "offset"),
      seqs: column(negativeOffset, "seq"),
    },
    { offset: 0, seqs: [1, 2, 3, 4, 5] },
    "a negative offset starts at the first row",
  );
  const last = await api.browse("list", READINGS, {
    offset: 1200,
    limit: 200,
    sortKey: "seq",
  });
  const lastSeqs = column(last, "seq");
  assert.deepEqual(
    {
      rows: lastSeqs.length,
      first: lastSeqs[0],
      last: lastSeqs.at(-1),
      total: pick(last.body, "total"),
    },
    { rows: 50, first: 1201, last: 1250, total: 1250 },
    "offset 1200 at 200 rows answers the last 50 rows",
  );
  const past = await api.browse("list", READINGS, {
    offset: 1250,
    limit: 25,
    sortKey: "seq",
  });
  assert.deepEqual(
    { rows: rowsOf(past).length, total: pick(past.body, "total") },
    { rows: 0, total: 1250 },
    "an offset past the end answers no row and the total",
  );
  const seqs = async (sortDirection: string) =>
    column(
      await api.browse("list", READINGS, {
        sortKey: "seq",
        limit: 3,
        sortDirection,
      }),
      "seq",
    );
  assert.deepEqual(
    {
      asc: column(
        await api.browse("list", READINGS, { sortKey: "seq", limit: 3 }),
        "seq",
      ),
      desc: await seqs("desc"),
      DESC: await seqs("DESC"),
      up: await seqs("up"),
    },
    {
      asc: [1, 2, 3],
      desc: [1250, 1249, 1248],
      DESC: [1, 2, 3],
      up: [1, 2, 3],
    },
    "only the word desc sorts descending",
  );
  const noKey = await api.browse("list", READINGS, {
    sortDirection: "desc",
    limit: 2,
  });
  assert.deepEqual(
    column(noKey, "_id"),
    column(base, "_id").slice(0, 2),
    "a direction without a sort key keeps the stored order",
  );
}

async function assertListFilters(api: DataApi): Promise<void> {
  const total = async (params: Record<string, string | number>) =>
    pick((await api.browse("list", READINGS, params)).body, "total");
  const band1 = await api.browse("list", READINGS, {
    filter_band: "is:band-1",
    limit: 200,
    sortKey: "seq",
  });
  assert.deepEqual(
    {
      total: pick(band1.body, "total"),
      rows: rowsOf(band1).length,
      bands: [...new Set(column(band1, "band"))],
    },
    { total: 250, rows: 200, bands: ["band-1"] },
    "is:band-1 matches the 250 rows of band-1",
  );
  assert.deepEqual(
    {
      bare: await total({ filter_band: "band-1", limit: 1 }),
      upperIs: await total({ filter_band: "is:BAND-1", limit: 1 }),
      contains: await total({ filter_band: "contains:AND-2", limit: 1 }),
      unknownMode: await total({ filter_band: "starts:band", limit: 1 }),
      empty: await total({ filter_band: "", limit: 1 }),
      colon: await total({ filter_band: "contains:band-1:x", limit: 1 }),
      search: await total({ search: "BAND-3", limit: 1 }),
      none: await total({ search: "zzz-no-such-text" }),
    },
    {
      bare: 250,
      upperIs: 0,
      contains: 250,
      unknownMode: 1250,
      empty: 1250,
      colon: 0,
      search: 250,
      none: 0,
    },
    "a bare value is exact, is: is case-sensitive, contains: is not, an unknown mode or empty value filters nothing, only the first colon splits, search ignores case",
  );
  const seqIs = await api.browse("list", READINGS, { filter_seq: "is:100" });
  const seqContains = await api.browse("list", READINGS, {
    filter_seq: "contains:12",
    limit: 200,
  });
  assert.deepEqual(
    {
      is: [pick(seqIs.body, "total"), column(seqIs, "seq")],
      contains: [pick(seqContains.body, "total"), column(seqContains, "seq")],
    },
    { is: [1, [100]], contains: [1, [12]] },
    "a number cell is compared as a whole value: contains:12 finds 12, not 120 or 1200",
  );
  const searchId = await api.browse("list", READINGS, { search: "R_0042" });
  assert.deepEqual(
    [pick(searchId.body, "total"), column(searchId, "_id")],
    [1, ["r_0042"]],
    "search reads the id cell, ignoring case",
  );
  const searchNumber = await api.browse("list", READINGS, {
    search: "1250",
    limit: 5,
  });
  assert.ok(
    column(searchNumber, "seq").includes(1250),
    `search compares a number cell as a whole value: ${searchNumber.text}`,
  );
  const both = await api.browse("list", READINGS, {
    search: "band-1",
    filter_seq: "contains:6",
    limit: 5,
  });
  const twoFilters = await api.browse("list", READINGS, {
    filter_band: "is:band-1",
    filter_seq: "is:1",
    limit: 5,
  });
  assert.deepEqual(
    {
      both: [pick(both.body, "total"), column(both, "seq")],
      apart: await total({
        search: "band-2",
        filter_seq: "contains:6",
        limit: 5,
      }),
      twoFilters: [pick(twoFilters.body, "total"), column(twoFilters, "seq")],
    },
    { both: [1, [6]], apart: 0, twoFilters: [1, [1]] },
    "a search and filters combine, and the total counts the rows they all match",
  );
  assert.deepEqual(
    column(
      await api.browse("list", READINGS, {
        filter_band: "is:band-2",
        sortKey: "seq",
        sortDirection: "desc",
        limit: 2,
      }),
      "seq",
    ),
    [1247, 1242],
    "a filtered page sorts descending by seq",
  );
}

async function assertOwnerOnly(api: DataApi): Promise<void> {
  const reader = await createMemberSession("data-journeys-reader@example.test");
  try {
    const selection = `filter_schema=is:${SHOP}&filter_table=is:products`;
    const paths = [
      `/browse/list?${selection}`,
      `/browse/count?${selection}`,
      `/browse/columns?${selection}`,
      `/browse/tables?filter_schema=is:${SHOP}`,
      `/browse/get?${selection}&id=sku_desk`,
      `/browse/references?${selection}&id=sku_desk`,
      `/tables/instances?schema=${SHOP}`,
    ];
    const anonymous: number[] = [];
    const member: number[] = [];
    for (const path of paths) {
      anonymous.push((await callDatabase(null, "GET", path)).status);
      member.push((await callDatabase(reader, "GET", path)).status);
    }
    assert.deepEqual(
      { anonymous, member },
      {
        anonymous: paths.map(() => 401),
        member: paths.map(() => 403),
      },
      "a browse route that skips the owner gate answers a visitor or a member",
    );
    const edit = `/browse/edit?${selection}&id=sku_desk&connection=own`;
    assert.deepEqual(
      [
        (await callDatabase(null, "PUT", edit, { name: "Hacked" })).status,
        (await callDatabase(reader, "PUT", edit, { name: "Hacked" })).status,
      ],
      [401, 403],
      "an edit by a visitor or a member is refused",
    );
    assert.equal(
      pick(
        (await api.browse("get", `${SHOP}.products`, { id: "sku_desk" })).body,
        "name",
      ),
      "Standing desk",
      "a refused edit still wrote the row",
    );
    const same = await callDatabase(api.owner, "PUT", edit, {
      name: "Standing desk",
    });
    assert.equal(
      same.status,
      200,
      `the owner's edit is refused, so the refusals above prove nothing: ${same.text}`,
    );
  } finally {
    await reader.remove();
  }
}

describe("[integration] data journeys", function () {
  this.timeout(LOADED_HOST_TIMEOUT_MS);

  const api = withDataFixture("data-journeys-owner@example.test");

  it("the-instance-picker-lists-named-instances-with-a-search-and-a-limit", () =>
    assertInstancePicker(api()));
  it("list-clamps-the-page-and-orders-the-rows", () => assertListClamps(api()));
  it("list-filters-search-and-counts-follow-the-wire-tokens", () =>
    assertListFilters(api()));
  it("the-browse-api-answers-the-platform-owner-only", () =>
    assertOwnerOnly(api()));
});
