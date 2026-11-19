import { check } from "../../database.mjs";
import { editorText, openConsole, resultText, runSource } from "./console.mjs";

/** @typedef {import("../../database.mjs").Ctx} Ctx */

/** The deep link into the console, `/modules/database/query?schema=<schema>&table=<table>`. */
export const linkJourneys = [
  {
    id: "a-link-opens-the-console-on-the-table-in-the-instance-it-names",
    title: "/query?schema=&table= opens the console with a query on that table, on the default instance, the named one (instance=eu) or every instance (instance=all), the link leaves the URL, and Run reads the table",
    entryPoint: "/modules/database/query?schema=shop&table=orders, docs/5.extending.md deep links",
    async run(/** @type {Ctx} */ ctx) {
      const opened = async (/** @type {string} */ search) => {
        const tab = await openConsole(ctx, `/modules/database/query?${search}`);
        const source = await editorText(tab);
        const url = new URL(tab.page.url());
        return { tab, source, search: url.search };
      };
      const standard = await opened("schema=shop&table=products");
      await runSource(standard.tab, standard.source);
      const standardResult = await resultText(standard.tab);
      const named = await opened("schema=shop&table=orders&instance=eu");
      await runSource(named.tab, named.source);
      const namedResult = await resultText(named.tab);
      const every = await opened("schema=shop&table=orders&instance=all");
      await runSource(every.tab, every.source);
      const everyResult = await resultText(every.tab);
      await ctx.verify("the default instance", [
        check("the editor holds a query on shop.products, the default instance, 50 rows", standard.source === 'schemas.shop.instance().table("products").slice(0, 50)', standard.source),
        check("the link left the URL", standard.search === "", standard.search),
        check("Run reads the six products", /^Result 6 rows \d+ ms · read-only · shop\.products\b(?! @)/.test(standardResult), standardResult.slice(0, 120)),
      ]);
      await ctx.verify("a named instance", [
        check("the editor holds a query on shop.orders in eu", named.source === 'schemas.shop.instance("eu").table("orders").slice(0, 50)', named.source),
        check("the link left the URL", named.search === "", named.search),
        check("Run reads 50 rows of shop.orders @eu", /^Result 50 rows \d+ ms · read-only · shop\.orders @eu/.test(namedResult), namedResult.slice(0, 120)),
      ]);
      await ctx.verify("every instance", [
        check("the editor holds a query on shop.orders in every instance", every.source === 'schemas.shop.instance(CROSS_INSTANCE).table("orders").slice(0, 50)', every.source),
        check("the link left the URL", every.search === "", every.search),
        check("Run reads 50 rows of shop.orders @*", /^Result 50 rows \d+ ms · read-only · shop\.orders @\*/.test(everyResult), everyResult.slice(0, 120)),
      ]);
    },
  },
];
