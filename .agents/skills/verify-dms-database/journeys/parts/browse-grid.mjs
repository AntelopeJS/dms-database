import { guarded } from "../../guard.mjs";
import { check, pick, show } from "../../database.mjs";
import { addFilter, browse, columnValues, filterChips, gridRows, ids, openTable, pagingFooter, pickPageSize, rowsOf, settle, toolbarCount } from "./browse.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */
/** @typedef {import("../../database.mjs").Tab} Tab */

/**
 * Signs in and opens a table.
 *
 * @param {Ctx} ctx The journey
 * @param {string} schema The schema
 * @param {string} table The table
 * @param {string} [instance] The instance parameter
 * @returns {Promise<Tab>} The tab
 */
async function browser(ctx, schema, table, instance) {
  const tab = await ctx.tab();
  await tab.signIn("admin");
  await openTable(tab, schema, table, instance);
  return tab;
}

/**
 * @param {Tab} tab The tab
 * @param {string} column The column header
 * @returns {Promise<string | null>} Its aria-sort
 */
async function ariaSort(tab, column) {
  return tab.page.getByRole("columnheader", { name: new RegExp(`^${column}\\b`) }).getAttribute("aria-sort");
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const searchFilterSort = {
  id: "search-filters-and-sort-narrow-and-order-the-rows",
  title: "Ctrl / focuses Search rows and its text narrows the rows across every column; Add filter with contains and is exactly adds a chip, each chip removes alone and Clear all removes them all; a header click sorts ascending, then descending, then back to the stored order, and every page matches what the API answers for the same request",
  entryPoint: "/modules/database/data?schema=metrics&table=readings",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await browser(ctx, "metrics", "readings");
    const total = await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    await tab.press("Control+/");
    const focus = await tab.page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
    await tab.page.keyboard.type("BAND-3");
    const searched = await settle(() => toolbarCount(tab), (text) => text === "250 rows");
    const searchedBands = await columnValues(tab, "band");
    const apiSearch = await browse(ctx, "search BAND-3", "list", "metrics.readings", { search: "BAND-3", limit: 50 });
    await tab.fill({ role: "textbox", name: "Search rows" }, "r_0042");
    const byId = await settle(() => columnValues(tab, "_id"), (values) => values.length === 1);
    await tab.fill({ role: "textbox", name: "Search rows" }, "");
    await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    await ctx.verify("Search rows", [
      check("the toolbar counts 1,250 rows at first", total === "1,250 rows", total),
      check("Ctrl / focuses the Search rows field", focus === "Search rows", focus),
      check("BAND-3 narrows to 250 rows, the first 50 shown, all of band-3", searched === "250 rows" && searchedBands.length === 50 && searchedBands.every((band) => band === "band-3"), [searched, searchedBands.length]),
      check("the grid shows the rows the API answers for the same search", show((await columnValues(tab, "_id")).length) === "50" && pick(apiSearch.body, "total") === 250, pick(apiSearch.body, "total")),
      check("a search reads the id column too: r_0042 alone", show(byId) === '["r_0042"]', byId),
    ]);
    await addFilter(tab, "band", "is exactly", "band");
    const exactNone = await settle(() => toolbarCount(tab), (text) => text === "0 rows");
    const chipExact = await filterChips(tab);
    await tab.click({ role: "button", name: "Remove the filter on band" });
    await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    await addFilter(tab, "band", "contains", "BAND");
    const containsAll = await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    const chipContains = await filterChips(tab);
    await tab.click({ role: "button", name: "Remove the filter on band" });
    await addFilter(tab, "band", "is exactly", "band-2");
    const bandTwo = await settle(() => toolbarCount(tab), (text) => text === "250 rows");
    await addFilter(tab, "seq", "contains", "5");
    const seqCount = Array.from({ length: 1250 }, (_, index) => index).filter((index) => index % 5 === 1 && String(index + 1).includes("5")).length;
    const both = await settle(() => toolbarCount(tab), (text) => text === `${seqCount} rows`);
    const chipsBoth = await filterChips(tab);
    const apiBoth = await browse(ctx, "the same two filters", "list", "metrics.readings", { filter_band: "is:band-2", filter_seq: "contains:5", limit: 50, sortKey: "_id" });
    await tab.click({ role: "button", name: "Remove the filter on seq" });
    const oneLeft = await settle(() => filterChips(tab), (chips) => chips.length === 1);
    await tab.click({ role: "button", name: "Clear all" });
    const cleared = await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    const noChips = await filterChips(tab);
    await ctx.verify("Add filter", [
      check("is exactly band matches nothing: 0 rows", exactNone === "0 rows", exactNone),
      check("the chip names column, mode and value", show(chipExact) === '["band is exactly band"]', chipExact),
      check("contains BAND matches every row, whatever the case", containsAll === "1,250 rows" && show(chipContains) === '["band contains BAND"]', [containsAll, chipContains]),
      check("is exactly band-2 matches 250 rows", bandTwo === "250 rows", bandTwo),
      check(`two filters combine: ${seqCount} rows and two chips`, both === `${seqCount} rows` && show(chipsBoth) === '["band is exactly band-2","seq contains 5"]' && pick(apiBoth.body, "total") === seqCount, [both, chipsBoth, pick(apiBoth.body, "total")]),
      check("removing one chip keeps the other", show(oneLeft) === '["band is exactly band-2"]', oneLeft),
      check("Clear all removes every chip and restores 1,250 rows", cleared === "1,250 rows" && noChips.length === 0, [cleared, noChips]),
    ]);
    await tab.click({ role: "button", name: "Filter band" });
    const popover = tab.page.getByRole("dialog");
    await popover.getByRole("combobox").click();
    await tab.click({ role: "option", name: "is exactly", exact: true });
    await popover.getByRole("textbox").fill("band-4");
    await popover.getByRole("button", { name: "Apply" }).click();
    const headerFilter = await settle(() => toolbarCount(tab), (text) => text === "250 rows");
    const headerChip = await filterChips(tab);
    await tab.click({ role: "button", name: "Clear all" });
    await settle(() => toolbarCount(tab), (text) => text === "1,250 rows");
    await ctx.verify("the header funnel", [check("a column's funnel sets a filter and its chip appears", headerFilter === "250 rows" && show(headerChip) === '["band is exactly band-4"]', [headerFilter, headerChip])]);
    const stored = await settle(() => columnValues(tab, "_id"), (values) => values.length === 50);
    const apiStored = await browse(ctx, "the stored order", "list", "metrics.readings", { limit: 50 });
    await tab.click({ role: "button", name: "seq", exact: true });
    const ascending = await settle(() => columnValues(tab, "seq"), (values) => values[0] === "1");
    const ascSort = await ariaSort(tab, "seq");
    await tab.click({ role: "button", name: "seq", exact: true });
    const descending = await settle(() => columnValues(tab, "seq"), (values) => values[0] === "1250");
    const descSort = await ariaSort(tab, "seq");
    const apiDesc = await browse(ctx, "seq descending", "list", "metrics.readings", { sortKey: "seq", sortDirection: "desc", limit: 50 });
    await tab.click({ role: "button", name: "seq", exact: true });
    const unsorted = await settle(() => columnValues(tab, "_id"), (values) => values.join() === stored.join());
    const noSort = await ariaSort(tab, "seq");
    await tab.click({ role: "button", name: "value", exact: true });
    const byValue = await settle(() => columnValues(tab, "value"), (values) => values.length === 50 && values[0] === "0");
    const apiByValue = await browse(ctx, "value ascending, page 2", "list", "metrics.readings", { sortKey: "value", offset: 50, limit: 50 });
    await tab.page.getByRole("button", { name: "Next page" }).click();
    const pageTwo = await settle(() => columnValues(tab, "value"), (values) => values.length === 50 && values.join() !== byValue.join());
    await tab.click({ role: "button", name: "band", exact: true });
    const backToFirst = await settle(() => pagingFooter(tab), (state) => state.range.startsWith("1–"));
    await ctx.verify("sorting by a header", [
      check("the stored order first: the page the API answers without a sort", show(stored) === show(ids(rowsOf(apiStored))), [stored.slice(0, 3), ids(rowsOf(apiStored)).slice(0, 3)]),
      check("first click: ascending, seq 1 to 50, aria-sort ascending", show(ascending) === show(Array.from({ length: 50 }, (_, index) => String(index + 1))) && ascSort === "ascending", [ascending.slice(0, 3), ascSort]),
      check("second click: descending, 1250 down to 1201, aria-sort descending", show(descending) === show(Array.from({ length: 50 }, (_, index) => String(1250 - index))) && descSort === "descending" && show(descending) === show(rowsOf(apiDesc).map((row) => String(row.seq))), [descending.slice(0, 3), descSort]),
      check("third click: back to the stored order, no aria-sort", unsorted.join() === stored.join() && noSort === null, [unsorted.slice(0, 3), noSort]),
      check("sorting by value: the 13 zeros first, then 1s, never decreasing", byValue.slice(0, 13).every((cell) => cell === "0") && byValue[13] !== "0" && byValue.every((cell, index) => index === 0 || Number(cell) >= Number(byValue[index - 1])), byValue.slice(0, 16)),
      check("page 2 of that sort is the page the API answers for offset 50", show(pageTwo) === show(rowsOf(apiByValue).map((row) => String(row.value))), [pageTwo.slice(0, 5), rowsOf(apiByValue).slice(0, 5).map((row) => row.value)]),
      check("sorting again returns to the first page", backToFirst.range === "1–50", backToFirst.range),
    ]);
  },
};

/**
 * Picks a page size, goes to the last page and checks both against the API.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab The tab on readings sorted by seq
 * @param {number} size Rows per page
 * @returns {Promise<void>}
 */
async function checkSize(ctx, tab, size) {
  const pageCount = Math.ceil(1250 / size);
  const lastRows = 1250 - (pageCount - 1) * size;
  const lastRange = `${(pageCount - 1) * size + 1}–1250`;
  await pickPageSize(tab, size);
  const firstPage = await settle(() => pagingFooter(tab), (state) => state.size === String(size) && state.range === `1–${size}`);
  const firstGrid = await settle(() => gridRows(tab), (rows) => rows.length === size);
  await tab.page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: String(pageCount), exact: true }).click();
  const last = await settle(() => pagingFooter(tab), (state) => state.range === lastRange);
  const lastGrid = await settle(() => gridRows(tab), (rows) => rows.length === lastRows);
  const apiLast = await browse(ctx, `page ${pageCount} at ${size}`, "list", "metrics.readings", { offset: (pageCount - 1) * size, limit: size, sortKey: "seq" });
  const shownSeq = await columnValues(tab, "seq");
  await ctx.verify(`${size} rows per page`, [
    check(`the size selector shows ${size} and the first page holds ${size} rows`, firstPage.size === String(size) && firstGrid.length === size, [firstPage.size, firstGrid.length]),
    check(`the page buttons end at ${pageCount}`, firstPage.pages.at(-1) === String(pageCount), firstPage.pages),
    check(`page ${pageCount} reads ${lastRange}, ${lastRows} rows, Next disabled, Previous enabled`, last.range === lastRange && lastGrid.length === lastRows && last.nextDisabled && !last.previousDisabled, [last.range, lastGrid.length, last.nextDisabled, last.previousDisabled]),
    check("the last row of the last page is numbered 1250", lastGrid.at(-1)?.[0] === "1250", lastGrid.at(-1)?.[0]),
    check("the API answers the same rows for that page", rowsOf(apiLast).length === lastRows && show(shownSeq) === show(rowsOf(apiLast).map((row) => String(row.seq))), [rowsOf(apiLast).length, shownSeq.slice(0, 2)]),
  ]);
}

/** @typedef {{ needle: string, count: number, size: number, lastRange: string, pages: string[] }} Boundary */

/** @type {Boundary[]} */
const BOUNDARIES = [
  { needle: "r_00", count: 99, size: 100, lastRange: "1–99", pages: ["1"] },
  { needle: "r_01", count: 100, size: 100, lastRange: "1–100", pages: ["1"] },
  { needle: "r_01", count: 100, size: 50, lastRange: "51–100", pages: ["1", "2"] },
  { needle: "r_12", count: 51, size: 50, lastRange: "51–51", pages: ["1", "2"] },
  { needle: "r_12", count: 51, size: 100, lastRange: "1–51", pages: ["1"] },
];

/**
 * Searches for ids so that the match count sits at a page boundary, and checks the pages and the last range.
 *
 * @param {Ctx} ctx The journey
 * @param {Tab} tab The tab on readings
 * @param {Boundary} boundary The search, the rows it matches and the page size
 * @returns {Promise<void>}
 */
async function checkBoundary(ctx, tab, boundary) {
  const { needle, count, size, lastRange, pages } = boundary;
  await pickPageSize(tab, size);
  await tab.fill({ role: "textbox", name: "Search rows" }, needle);
  const settled = await settle(() => pagingFooter(tab), (state) => state.rows === `${count} rows` && state.size === String(size));
  const lastPageButton = pages.at(-1) ?? "1";
  if (lastPageButton !== "1") await tab.page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: lastPageButton, exact: true }).click();
  const endState = await settle(() => pagingFooter(tab), (state) => state.range === lastRange);
  await ctx.verify(`${count} rows at ${size} per page`, [
    check(`${count} rows pages as ${pages.join(", ")}`, settled.pages.join() === pages.join(), settled),
    check(`the last page reads ${lastRange} and Next is disabled`, endState.range === lastRange && endState.nextDisabled, endState),
  ]);
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }} */
const paging = {
  id: "the-footer-pages-1250-rows-with-exact-ranges-at-every-size",
  title: "25, 50, 100 and 200 rows per page give 50, 25, 13 and 7 pages of 1,250 rows, the last page holds 25, 50, 50 and 50 rows, Previous and Next are disabled at the ends, and totals of 99, 100 and 51 rows page exactly at their boundaries",
  entryPoint: "/modules/database/data?schema=metrics&table=readings",
  async run(/** @type {Ctx} */ ctx) {
    const tab = await browser(ctx, "metrics", "readings");
    await tab.click({ role: "button", name: "seq", exact: true });
    const first = await settle(() => pagingFooter(tab), (state) => state.range === "1–50");
    const firstRows = await settle(() => gridRows(tab), (rows) => rows.length === 50);
    await ctx.verify("the default page", [
      check("the footer counts 1,250 rows, 50 per page, 1–50", first.rows === "1,250 rows" && first.size === "50" && first.range === "1–50", first),
      check("Previous is disabled and Next enabled on the first page", first.previousDisabled && !first.nextDisabled, first),
      check("the page buttons are 1 to 3 around the first page and the last, 25", first.pages.join() === "1,2,3,25", first.pages),
      check("50 rows, numbered 1 to 50", firstRows.length === 50 && firstRows[0]?.[0] === "1" && firstRows[49]?.[0] === "50", [firstRows.length, firstRows[0]?.[0], firstRows.at(-1)?.[0]]),
    ]);
    for (const size of [25, 100, 200, 50]) await checkSize(ctx, tab, size);
    await tab.page.getByRole("button", { name: "Previous page" }).click();
    const previous = await settle(() => pagingFooter(tab), (state) => state.range === "1151–1200");
    await tab.page.getByRole("button", { name: "Next page" }).click();
    const next = await settle(() => pagingFooter(tab), (state) => state.range === "1201–1250");
    await pickPageSize(tab, 25);
    const reset = await settle(() => pagingFooter(tab), (state) => state.size === "25");
    await ctx.verify("Previous, Next and the size reset the page", [
      check("Previous steps back one page: 1151–1200 at 50 per page", previous.range === "1151–1200", previous.range),
      check("Next steps forward: 1201–1250", next.range === "1201–1250", next.range),
      check("changing the size returns to the first page", reset.range === "1–25" && reset.previousDisabled, reset),
    ]);
    await pickPageSize(tab, 50);
    for (const boundary of BOUNDARIES) await checkBoundary(ctx, tab, boundary);
  },
};

export const gridJourneys = guarded([searchFilterSort, paging]);
