import { Schema } from "@antelopejs/interface-database";
import { Field, RegisterSchema, RegisterTable, Relation, Table } from "@antelopejs/interface-database-decorators";
import { Customer } from "./shop-schema";

/** Schemas the verification adds to the shop and vault: a cross-schema relation, tables of exactly 12 and 13 columns, a relation ending on the 14th column of its target, named instances created out of order, a column named like an object member, and a schema without a table. */
export const LINKS_SCHEMA = "links";
export const QUIRKS_SCHEMA = "quirks";
export const HOLLOW_SCHEMA = "hollow";

@RegisterTable("customer_refs", LINKS_SCHEMA)
export class CustomerRef extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => Customer }) declare customer_id: string;
}

@RegisterTable("twelve_columns", LINKS_SCHEMA)
export class TwelveColumns extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare c01: string;
  @Field("string") declare c02: string;
  @Field("string") declare c03: string;
  @Field("string") declare c04: string;
  @Field("string") declare c05: string;
  @Field("string") declare c06: string;
  @Field("string") declare c07: string;
  @Field("string") declare c08: string;
  @Field("string") declare c09: string;
  @Field("string") declare c10: string;
  @Field("string") declare c11: string;
}

@RegisterTable("thirteen_columns", LINKS_SCHEMA)
export class ThirteenColumns extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare c01: string;
  @Field("string") declare c02: string;
  @Field("string") declare c03: string;
  @Field("string") declare c04: string;
  @Field("string") declare c05: string;
  @Field("string") declare c06: string;
  @Field("string") declare c07: string;
  @Field("string") declare c08: string;
  @Field("string") declare c09: string;
  @Field("string") declare c10: string;
  @Field("string") declare c11: string;
  @Field("string") declare c12: string;
}

@RegisterTable("anchor_target", LINKS_SCHEMA)
export class AnchorTarget extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare c01: string;
  @Field("string") declare c02: string;
  @Field("string") declare c03: string;
  @Field("string") declare c04: string;
  @Field("string") declare c05: string;
  @Field("string") declare c06: string;
  @Field("string") declare c07: string;
  @Field("string") declare c08: string;
  @Field("string") declare c09: string;
  @Field("string") declare c10: string;
  @Field("string") declare c11: string;
  @Field("string") declare c12: string;
  @Field("string") declare c13: string;
}

@RegisterTable("anchor_source", LINKS_SCHEMA)
export class AnchorSource extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => AnchorTarget, toField: "c13" }) declare target_ref: string;
}

@RegisterTable("members", QUIRKS_SCHEMA)
export class Member extends Table {
  @Field("string") declare _id: string;
}

interface MemberRow {
  _id: string;
  [column: string]: string;
}

interface LinksTables {
  customer_refs: CustomerRef;
}

const TENANTS = ["tenant-10", "tenant-2", "tenant-1"] as const;

interface QuirksTables {
  members: Member;
}

/** Registers the links, quirks and hollow schemas, and gives `members` one row whose column is named `constructor`. */
export async function startBridgeSchemas(): Promise<void> {
  await RegisterSchema(LINKS_SCHEMA);
  const links = Schema.get<LinksTables>(LINKS_SCHEMA);
  for (const tenant of TENANTS) await links?.createInstance(tenant).run().catch(() => undefined);
  await RegisterSchema(QUIRKS_SCHEMA);
  new Schema(HOLLOW_SCHEMA, {});
  const schema = Schema.get<QuirksTables>(QUIRKS_SCHEMA);
  if (!schema) return;
  const members = schema.instance().table("members");
  if ((await members.count()) > 0) return;
  const row: MemberRow = { _id: "member_1", ["constructor"]: "ctor value", note: "plain column" };
  await members.insert([row], { conflict: "update" }).run();
}
