import {
  EncryptionModifier,
  Encrypted,
  Field,
  HashModifier,
  Hashed,
  LocalizationModifier,
  Localized,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";

/** Three tables that each carry exactly one kind of modifier. */
export const MODS_SCHEMA = "mods";

const SECRET_KEY = "verify-secret-key-0123456789abcd";

@RegisterTable("hashed_only", MODS_SCHEMA)
export class HashedOnly extends Table.with(HashModifier) {
  @Field("string") declare _id: string;
  @Hashed() @Field("string") declare token: string;
}

@RegisterTable("localized_only", MODS_SCHEMA)
export class LocalizedOnly extends Table.with(LocalizationModifier) {
  @Field("string") declare _id: string;
  @Localized({ fallbackLocale: "en" }) @Field("string") declare title: string;
}

@RegisterTable("encrypted_only", MODS_SCHEMA)
export class EncryptedOnly extends Table.with(EncryptionModifier) {
  @Field("string") declare _id: string;
  @Encrypted({ secretKey: SECRET_KEY }) @Field("string") declare secret: string;
}
