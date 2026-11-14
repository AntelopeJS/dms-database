import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import {
  CreationTime,
  Encrypted,
  EncryptionModifier,
  Field,
  Index,
  LocalizationModifier,
  Localized,
  RegisterSchema,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db";
import { DatabaseBrowseController } from "../routes/data";

/**
 * A store may read a declared `Date` back as an ISO string (PostgreSQL keeps
 * it in jsonb): the data browser still types the column `date`, from the
 * declaration, and samples only the columns nothing declares. A field behind a
 * two-way modifier holds its locked value when a raw AQL write puts it at the
 * top level, so the sample types it.
 */
const SCHEMA = "browse-declared-types";
const USER = Object.assign(new User(), { _id: "browse-declared-user" });
const ISO = "2026-11-05T15:09:17.514+00:00";

@RegisterTable("orders", SCHEMA)
class DeclaredTypesOrder extends Table {
  declare _id: string;
  @Index() declare created_at: Date;
  @CreationTime() declare stamped_at: Date;
}

@RegisterTable("secrets", SCHEMA)
class DeclaredTypesSecret extends Table.with(
  LocalizationModifier,
  EncryptionModifier,
) {
  declare _id: string;
  @Localized({ fallbackLocale: "en" }) @Field("string") declare name: string;
  @Encrypted({ secretKey: "declared-types-secret-key-012345" })
  @Field("string")
  declare secret: string;
}

/** Keeps the decorated classes referenced: the decorators register them. */
const TABLES = [DeclaredTypesOrder, DeclaredTypesSecret];

interface EventRow {
  _id: string;
  at: string;
  label: string;
  note: string | number;
}

const DEFINED = "browse-declared-defined";
const defined = new Schema<{ events: EventRow }>(DEFINED, {
  events: {
    fields: { _id: "string", at: "date", label: "string" },
    indexes: {},
  },
});

function store() {
  const schema = Schema.get(SCHEMA);
  assert.ok(schema, "the test schema is registered");
  return schema.instance();
}

function orders() {
  return store().table("orders");
}

describe("[integration] browse columns: declared types", () => {
  before(async () => {
    assert.equal(TABLES.length, 2);
    await RegisterSchema(SCHEMA);
    await orders()
      .insert([{ _id: "o1", created_at: ISO, stamped_at: ISO, extra: 1 }])
      .run();
    await store()
      .table("secrets")
      .insert([
        {
          _id: "s1",
          name: { en: "Chair", fr: "Chaise" },
          secret: ["cipher", "iv", "tag"],
        },
      ])
      .run();
    await defined
      .createInstance()
      .run()
      .catch(() => undefined);
    await defined
      .instance()
      .table("events")
      .insert([{ _id: "e1", at: ISO, label: "x", note: 2 }])
      .run();
  });

  after(async () => {
    await orders().delete().run();
    await store().table("secrets").delete().run();
    await defined.instance().table("events").delete().run();
  });

  it("types a decorated Date column read back as a string as date", async () => {
    const meta = await new DatabaseBrowseController().columns(
      USER,
      `is:${SCHEMA}`,
      undefined,
      "is:orders",
    );
    assert.equal(meta.types.created_at, "date");
    assert.equal(meta.types.stamped_at, "date");
    assert.equal(meta.types.extra, "number");
  });

  it("types a defined date field read back as a string as date", async () => {
    const meta = await new DatabaseBrowseController().columns(
      USER,
      `is:${DEFINED}`,
      undefined,
      "is:events",
    );
    assert.deepEqual(meta.types, {
      _id: "string",
      _instance: "null",
      at: "date",
      label: "string",
      note: "number",
    });
  });

  it("types a two-way modified column by its stored value", async () => {
    const meta = await new DatabaseBrowseController().columns(
      USER,
      `is:${SCHEMA}`,
      undefined,
      "is:secrets",
    );
    assert.equal(meta.types.name, "object");
    assert.equal(meta.types.secret, "array");
  });
});
