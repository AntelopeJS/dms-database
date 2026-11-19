import { strict as assert } from "node:assert";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { ConnectionSelectionModel } from "../db/models/connection_selections.model";
import { DatabaseBrowseController } from "../routes/data";
import { DatabaseSchemasController } from "../routes/schemas";
import { isCatalogSchema } from "../service/catalogSchemas";
import { resolveDatabase } from "../service/connections";
import { queryContext } from "./requestContext";

const ARCHIVE = "archive";
const USER = Object.assign(new User(), { _id: "catalog-browse-user" });

describe("[integration] a connected database no tables module declares", () => {
  before(async () => {
    await GetModel(ConnectionSelectionModel).select(USER._id, ARCHIVE);
  });

  it("lists the tables its catalog describes and browses their rows, which a console reading registered tables alone shows empty", async () => {
    const { schemas } = await new DatabaseSchemasController().list(USER);
    assert.deepEqual(
      schemas.map(({ id, stats, tables }) => ({
        id,
        elementCount: stats.elementCount,
        tables: tables.map(({ name, fields }) => ({
          name,
          fields: Object.keys(fields).sort(),
        })),
      })),
      [
        {
          id: ARCHIVE,
          elementCount: 1,
          tables: [{ name: "invoices", fields: ["_id", "amount"] }],
        },
      ],
    );
    const page = await new DatabaseBrowseController().list(
      USER,
      queryContext({
        filter_schema: `is:${ARCHIVE}`,
        filter_table: "is:invoices",
      }),
    );
    assert.deepEqual(page.results, [{ _id: "i1", amount: 42 }]);
    assert.equal(page.primaryKey, "_id");
  });

  it("keeps the schema a tables module defines, which a console defining every catalog schema would replace", async () => {
    const erp = (await resolveDatabase("erp")).schemas().get("erp");
    assert.ok(erp, "the erp tables module defines erp");
    assert.equal(isCatalogSchema(erp), false);
    const archive = (await resolveDatabase(ARCHIVE)).schemas().get(ARCHIVE);
    assert.ok(archive, "the console defines archive from its catalog");
    assert.equal(isCatalogSchema(archive), true);
  });
});
