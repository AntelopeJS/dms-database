import {
  EncryptionModifier,
  Encrypted,
  Field,
  HashModifier,
  Hashed,
  Index,
  LocalizationModifier,
  Localized,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { Schema } from "@antelopejs/interface-database";

/** A schema whose tables carry every modifier and a table with more than twelve columns. */
export const VAULT_SCHEMA = "vault";

/** Exactly 32 UTF-8 bytes, as the default cipher needs. */
const SECRET_KEY = "verify-secret-key-0123456789abcd";

@RegisterTable("accounts", VAULT_SCHEMA)
export class Account extends Table.with(HashModifier, EncryptionModifier, LocalizationModifier) {
  @Field("string") declare _id: string;
  @Index() @Field("string") declare handle: string;
  @Hashed() @Field("string") declare password: string;
  @Encrypted({ secretKey: SECRET_KEY }) @Field("string") declare card_number: string;
  @Localized({ fallbackLocale: "en" }) @Field("string") declare display_name: string;
}

@RegisterTable("plain_notes", VAULT_SCHEMA)
export class PlainNote extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare body: string;
}

@RegisterTable("parents_registry", VAULT_SCHEMA)
export class ParentsRegistry extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare label: string;
}

@RegisterTable("parents_links", VAULT_SCHEMA)
export class ParentsLinks extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => ParentsRegistry }) declare registry_id: string;
}

@RegisterTable("wide_records", VAULT_SCHEMA)
export class WideRecord extends Table {
  @Field("string") declare _id: string;
  @Relation({ to: () => ParentsRegistry }) declare registry_id: string;
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
  @Field("string") declare c14: string;
  @Field("string") declare tail_marker: string;
}

interface VaultTables {
  accounts: Account;
  plain_notes: PlainNote;
  parents_registry: ParentsRegistry;
  parents_links: ParentsLinks;
  wide_records: WideRecord;
}

/** Fills the vault once, on a database that has none of it. */
export async function seedVault(): Promise<void> {
  const schema = Schema.get<VaultTables>(VAULT_SCHEMA);
  if (!schema) return;
  const notes = schema.instance().table("plain_notes");
  if ((await notes.count()) > 0) return;
  await notes.insert([{ _id: "note_1", body: "first note" }]).run();
  await schema.instance().table("parents_registry").insert([{ _id: "reg_1", label: "registry one" }]).run();
  await schema.instance().table("parents_links").insert([{ _id: "lnk_1", registry_id: "reg_1" }]).run();
  await schema.instance().table("wide_records").insert([{ _id: "wide_1", registry_id: "reg_1", c01: "a", tail_marker: "tail" }]).run();
}
