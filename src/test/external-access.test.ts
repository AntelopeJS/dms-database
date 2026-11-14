import { strict as assert } from "node:assert";
import { User } from "@antelopejs/interface-dms/auth/db";
import { getModuleConfig, setModuleConfig } from "../config";
import { DatabaseConnectionsController } from "../routes/connections";
import { DatabaseBrowseController } from "../routes/data";
import {
  READ_ONLY_ACCOUNT,
  STALE_DATABASE,
  writeAccess,
} from "../service/connectionState";
import { refusal } from "./refusal";
import { queryContext } from "./requestContext";
import { writerCalls } from "./writerCalls";

const controller = new DatabaseConnectionsController();
const browse = new DatabaseBrowseController();
const original = getModuleConfig();

function user(id: string): User {
  return Object.assign(new User(), { _id: id });
}

/** The query of an edit of erp's c1, made on `database` when it names one. */
function c1Edit(database?: string) {
  const row = {
    filter_schema: "is:erp",
    filter_table: "is:customers",
    id: "c1",
  };
  return queryContext(
    database === undefined ? row : { ...row, connection: database },
  );
}

/** Edits erp's c1 as `editor`, the page naming `database` as the one it was made on. */
function edit(editor: User, name: string, database = "erp") {
  return browse.edit(editor, c1Edit(database), { name });
}

async function accessOf(connection: string): Promise<string | undefined> {
  const { connections } = await controller.list(user("access-reader"));
  return connections.find(({ id }) => id === connection)?.access;
}

describe("[integration] external connections: changing access", () => {
  beforeEach(() => setModuleConfig({ ...original, externalConnections: {} }));
  afterEach(() => setModuleConfig(original));

  it("refuses an access change outside development, on the own database and with a bad body, writing nothing", async () => {
    const owner = user("access-user");
    const before = writerCalls().length;
    assert.deepEqual(
      await refusal(controller.access(owner, "erp", { access: "read-write" })),
      { status: 403, message: "Access can only change in development" },
    );
    assert.deepEqual(
      await refusal(controller.access(owner, "own", { access: "read" })),
      { status: 400, message: "The project's own database is always writable" },
    );
    assert.deepEqual(
      await refusal(controller.access(owner, "erp", { access: "write" })),
      { status: 400, message: 'Expected { access: "read" | "read-write" }' },
    );
    assert.equal((await controller.list(owner)).accessEditable, false);
    assert.equal(writerCalls().length, before);
  });

  it("refuses read-write when the account can only read, without writing the configuration", async () => {
    const before = writerCalls().length;
    assert.deepEqual(await refusal(writeAccess("archive", "read-write")), {
      status: 409,
      message: READ_ONLY_ACCOUNT,
    });
    assert.equal(writerCalls().length, before);
  });

  it("writes read-write to the dms-database entry through the configuration writer, keeping the other connections, and follows it", async () => {
    setModuleConfig({
      ...original,
      externalConnections: { archive: { access: "read" } },
    });
    await writeAccess("erp", "read-write");
    assert.equal(await accessOf("erp"), "read-write");
    assert.deepEqual(writerCalls().at(-1), {
      id: "local",
      entry: {
        config: {
          externalConnections: {
            archive: { access: "read" },
            erp: { access: "read-write" },
          },
        },
      },
    });
  });

  it("keeps a revocation when another change is in flight, which two writes from one snapshot lose", async () => {
    await writeAccess("erp", "read-write");
    await Promise.all([
      writeAccess("erp", "read"),
      writeAccess("archive", "read"),
    ]);
    assert.equal(await accessOf("erp"), "read");
    assert.deepEqual(writerCalls().at(-1), {
      id: "local",
      entry: {
        config: {
          externalConnections: {
            erp: { access: "read" },
            archive: { access: "read" },
          },
        },
      },
    });
    const editor = user("race-editor");
    await controller.select(editor, { connection: "erp" });
    assert.deepEqual(await refusal(edit(editor, "Ada")), {
      status: 403,
      message: "Access to erp is read only",
    });
  });
});

describe("[integration] external connections: writes through the Data browser", () => {
  const writer = user("browse-writer");

  before(async () => {
    await controller.select(writer, { connection: "erp" });
  });

  afterEach(async () => {
    await writeAccess("erp", "read-write");
    await edit(writer, "Ada");
    setModuleConfig(original);
  });

  it("refuses an edit of the selected external database while its access is read, then writes the customer's row once it is read-write", async () => {
    assert.deepEqual(await refusal(edit(writer, "Ada Lovelace")), {
      status: 403,
      message: "Access to erp is read only",
    });
    await writeAccess("erp", "read-write");
    assert.deepEqual(await edit(writer, "Ada Lovelace"), {
      _id: "c1",
      name: "Ada Lovelace",
      segment: "retail",
    });
    assert.deepEqual(
      await browse.get(writer, "is:erp", undefined, "is:customers", "c1"),
      { _id: "c1", name: "Ada Lovelace", segment: "retail" },
    );
  });

  it("refuses an edit made on another database than the one the user now browses, which a stale tab would write to the wrong database", async () => {
    await writeAccess("erp", "read-write");
    assert.deepEqual(await refusal(edit(writer, "From a stale tab", "own")), {
      status: 409,
      message: STALE_DATABASE,
    });
    assert.deepEqual(
      await refusal(browse.edit(writer, c1Edit(), { name: "No connection" })),
      { status: 400, message: "Missing 'connection'" },
    );
    assert.deepEqual(
      await browse.get(writer, "is:erp", undefined, "is:customers", "c1"),
      { _id: "c1", name: "Ada", segment: "retail" },
    );
  });
});
