import { strict as assert } from "node:assert";
import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
} from "@antelopejs/interface-data-api/metadata";
import {
  BasicDataModel,
  Field,
  Model,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import {
  ArchiveField,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base/table-view";
import { ExternalConnection } from "@antelopejs/interface-dms/connection-access";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { isObject } from "../utils/guards";
import { type OwnerSession, createOwnerSession } from "./ownerSession";

const TABLE = "connection-access-countries";
const API = "http://127.0.0.1:5023/api/connection-access";

@RegisterTable(TABLE, CORE_SCHEMA_NAME)
class Country extends Table {
  @Field("string") declare name: string;
  @Field("boolean") declare isArchived?: boolean;
}

class CountryModel extends BasicDataModel(Country, TABLE) {}

/** The fields a mapped table's controller serves, as the builder generates them. */
function MappedCountries(path: string) {
  class Mapped extends DataController(
    Country,
    TableViewRoutes.All,
    Controller(path),
  ) {
    @ModelReference()
    @Model(CountryModel)
    declare model: CountryModel;

    @Listable()
    @Select()
    @Access(AccessMode.ReadOnly)
    declare _id: string;

    @Listable()
    @Select()
    @Access(AccessMode.ReadWrite)
    declare name: string;

    @ArchiveField()
    declare isArchived: boolean;
  }
  return Mapped;
}

@RegisterDataController()
@ExternalConnection("erp")
export class ReadWriteCountries extends MappedCountries(
  "/api/connection-access/erp",
) {}

@RegisterDataController()
@ExternalConnection("legacy")
export class ReadCountries extends MappedCountries(
  "/api/connection-access/legacy",
) {}

@RegisterDataController()
@ExternalConnection("blank")
export class BlankCountries extends MappedCountries(
  "/api/connection-access/blank",
) {}

@RegisterDataController()
@ExternalConnection("unlisted")
export class UnlistedCountries extends MappedCountries(
  "/api/connection-access/unlisted",
) {}

describe("[integration] a table mapped from an external connection", () => {
  let owner: OwnerSession;

  const send = (method: string, url: string, body?: { name: string }) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
        "x-antelopejs-namespace": "default",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  before(async () => {
    owner = await createOwnerSession("connection-access@example.test");
  });

  after(async () => {
    await owner.remove();
  });

  it("writes through its generated routes when config.externalConnections makes it read-write", async () => {
    const created = await send("POST", `${API}/erp/new`, { name: "France" });
    const body = await created.text();
    assert.equal(created.status, 200, body);
    const row: unknown = JSON.parse(body);
    assert.ok(isObject(row) && "_id" in row);
    const id = String(row._id);
    const edited = await send("PUT", `${API}/erp/edit?id=${id}`, {
      name: "Republic of France",
    });
    assert.equal(edited.status, 200, await edited.text());
    const removed = await send("DELETE", `${API}/erp/delete?id=${id}`);
    assert.equal(removed.status, 200, await removed.text());
  });

  for (const connection of ["legacy", "blank", "unlisted"]) {
    it(`answers 403 to a write on the ${connection} connection, which config.externalConnections leaves read-only, and still lists`, async () => {
      const created = await send("POST", `${API}/${connection}/new`, {
        name: "Spain",
      });
      const body = await created.text();
      assert.equal(created.status, 403, body);
      assert.match(body, new RegExp(`Connection "${connection}" is read-only`));
      const listed = await send(
        "GET",
        `${API}/${connection}/list?limit=50&showArchived=false`,
      );
      assert.equal(listed.status, 200, await listed.text());
    });
  }
});
