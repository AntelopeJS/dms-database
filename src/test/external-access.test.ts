import { strict as assert } from "node:assert";
import { User } from "@antelopejs/interface-dms/auth/db";
import {
  type DmsDatabaseConfig,
  getModuleConfig,
  setModuleConfig,
} from "../config";
import { DatabaseConnectionsController } from "../routes/connections";
import { DatabaseBrowseController } from "../routes/data";
import { REFUSALS } from "../service/refusals";
import { writeAccess } from "../service/connectionState";
import { keyedRefusal, refusal, refused } from "./refusal";
import { queryContext } from "./requestContext";
import { answerNextWrite, writerCalls } from "./writerCalls";
import { LOADED_HOST_TIMEOUT_MS } from "./helpers/timeouts";

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

describe("[integration] external connections: changing access", function () {
  this.timeout(LOADED_HOST_TIMEOUT_MS);

  beforeEach(() => setModuleConfig({ ...original, externalConnections: {} }));
  afterEach(() => setModuleConfig(original));

  it("refuses an access change outside development, on the own database and with a bad body, writing nothing", async () => {
    const owner = user("access-user");
    const before = writerCalls().length;
    assert.deepEqual(
      await refusal(controller.access(owner, "erp", { access: "read-write" })),
      refused(REFUSALS.notDevelopment),
    );
    assert.deepEqual(
      await refusal(controller.access(owner, "own", { access: "read" })),
      refused(REFUSALS.ownDatabaseAccess),
    );
    assert.deepEqual(
      await refusal(controller.access(owner, "erp", { access: "write" })),
      refused(REFUSALS.accessBody),
    );
    assert.equal((await controller.list(owner)).accessEditable, false);
    assert.equal(writerCalls().length, before);
  });

  it("refuses read-write when the account can only read, without writing the configuration", async () => {
    const before = writerCalls().length;
    assert.deepEqual(
      await refusal(writeAccess("archive", "read-write")),
      refused(REFUSALS.readOnlyAccount),
    );
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

  it("writes the malformed access of another connection back as the project gave it and a null entry as an empty one, and follows the change", async () => {
    const archive = {};
    const ledger = {};
    Reflect.set(archive, "access", "readwrite");
    Reflect.set(ledger, "access", true);
    const externalConnections = {
      archive,
      ledger,
      erp: { access: "read" },
    } satisfies DmsDatabaseConfig["externalConnections"];
    Reflect.set(externalConnections, "crm", null);
    setModuleConfig({ ...original, externalConnections });
    await writeAccess("erp", "read-write");
    assert.equal(await accessOf("erp"), "read-write");
    assert.deepEqual(writerCalls().at(-1), {
      id: "local",
      entry: {
        config: {
          externalConnections: {
            archive: { access: "readwrite" },
            ledger: { access: true },
            crm: {},
            erp: { access: "read-write" },
          },
        },
      },
    });
  });

  it("writes over a malformed access on the connection the owner changes", async () => {
    const erp = {};
    Reflect.set(erp, "access", "readwrite");
    setModuleConfig({ ...original, externalConnections: { erp } });
    await writeAccess("erp", "read");
    assert.deepEqual(writerCalls().at(-1), {
      id: "local",
      entry: { config: { externalConnections: { erp: { access: "read" } } } },
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
    assert.deepEqual(await keyedRefusal(edit(editor, "Ada")), {
      status: 403,
      body: {
        message: REFUSALS.readOnlyConnection.key,
        params: { connection: "erp" },
        severity: "warning",
      },
    });
  });
});

describe("[integration] external connections: a refused access write", () => {
  beforeEach(() => setModuleConfig({ ...original, externalConnections: {} }));
  afterEach(() => setModuleConfig(original));

  it("answers 409 with the writer's reason when the builder refuses, and keeps the access", async () => {
    answerNextWrite({
      code: "invalid_config",
      issues: [
        { pointer: "/modules/local/config", message: "is held in a variable" },
        { pointer: "", message: "the configuration is spread" },
      ],
    });
    assert.deepEqual(
      await refusal(writeAccess("erp", "read-write")),
      refused(REFUSALS.builderRefused, {
        reason:
          "/modules/local/config is held in a variable; the configuration is spread",
      }),
    );
    assert.equal(await accessOf("erp"), "read");
  });

  it("answers 503 only when the builder does not answer", async () => {
    answerNextWrite("absent");
    assert.deepEqual(
      await refusal(writeAccess("erp", "read-write")),
      refused(REFUSALS.noBuilder),
    );
    assert.equal(await accessOf("erp"), "read");
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
    assert.deepEqual(await keyedRefusal(edit(writer, "Ada Lovelace")), {
      status: 403,
      body: {
        message: REFUSALS.readOnlyConnection.key,
        params: { connection: "erp" },
        severity: "warning",
      },
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
    assert.deepEqual(
      await keyedRefusal(edit(writer, "From a stale tab", "own")),
      {
        status: 409,
        body: {
          message: REFUSALS.staleDatabase.key,
          params: {},
          severity: "warning",
        },
      },
    );
    assert.deepEqual(
      await refusal(browse.edit(writer, c1Edit(), { name: "No connection" })),
      refused(REFUSALS.missingParameter, { name: "connection" }),
    );
    assert.deepEqual(
      await browse.get(writer, "is:erp", undefined, "is:customers", "c1"),
      { _id: "c1", name: "Ada", segment: "retail" },
    );
  });
});
