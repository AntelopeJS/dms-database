import { guarded } from "../../guard.mjs";
import { check } from "../../database.mjs";
import { DATA_PAGE, pickInstance, pickSchema, settle } from "./browse.mjs";
import { cellState, reviewLabel, storedRow, typeInto } from "./edit.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

export const discardJourneys = guarded([
  {
    id: "discard-drops-the-changes-of-every-staged-row",
    title: "with changes staged on three rows of orders @eu, Discard empties the bar, restores every cell without a struck value, writes nothing and leaves the stored rows as they were",
    entryPoint: "/modules/database/data save bar Discard",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(DATA_PAGE);
      await tab.visible({ role: "textbox", name: "Find a table" }, { timeoutMs: 60_000 });
      await pickSchema(tab, "shop");
      await pickInstance(tab, "eu");
      await tab.page.locator("aside nav button").filter({ hasText: /^orders/ }).click();
      await tab.visible({ role: "textbox", name: "Search rows" });
      const rows = ["eu_ord_10400", "eu_ord_10401", "eu_ord_10402"];
      const before = [];
      for (const id of rows) before.push(await storedRow(ctx, "orders", id, "eu"));
      /** @type {string[]} */
      const writes = [];
      tab.page.on("request", (request) => {
        if (request.method() === "PUT" && request.url().includes("/api/database/browse/edit")) writes.push(request.url());
      });
      for (const [index, id] of rows.entries()) await typeInto(tab, id, "channel", `changed-${index}`);
      await typeInto(tab, rows[0] ?? "", "currency", "XXX");
      const staged = await settle(() => reviewLabel(tab), (label) => label === "Review and save 4 changes");
      const struck = [];
      for (const id of rows) struck.push((await cellState(tab, id, "channel")).struck);
      await tab.click({ role: "button", name: "Discard", exact: true });
      const bar = await settle(() => reviewLabel(tab), (label) => label !== "Review and save 4 changes");
      const after = [];
      for (const id of rows) after.push(await cellState(tab, id, "channel"));
      const currency = await cellState(tab, rows[0] ?? "", "currency");
      const stored = [];
      for (const id of rows) stored.push(await storedRow(ctx, "orders", id, "eu"));
      await ctx.verify("Discard", [
        check("the bar counted four changes on three rows", staged === "Review and save 4 changes" && struck.every((entry) => entry !== ""), [staged, struck]),
        check("the bar is empty afterwards", !/Review and save/.test(bar), bar),
        check("no cell keeps a struck value", after.every((entry) => entry.struck === "") && currency.struck === "", [after, currency]),
        check("the cells show the stored channels again", after.every((entry, index) => entry.text === String(before[index]?.channel)) && currency.text === String(before[0]?.currency), [after.map((entry) => entry.text), before.map((row) => row.channel)]),
        check("nothing was written", writes.length === 0 && JSON.stringify(stored) === JSON.stringify(before), [writes, stored.map((row) => row.channel)]),
      ]);
    },
  },
]);
