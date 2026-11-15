import { Schema } from "@antelopejs/interface-database";
import type { Schema as StagedSchema } from "@antelopejs/interface-database/staged-query";

/** Stored text of a vault account, written as the stored form of each modified column. */
export const ACCOUNT_PASSWORD = "$argon2id$v=19$stored-hash-of-ada";
export const ACCOUNT_CARD = "enc:v1:stored-cipher-of-ada";
export const ACCOUNT_NAME_LONG =
  "Ada Lovelace, countess of Lovelace, the first person to publish an algorithm made for a machine\nsecond line of the long display name";

interface BrowseTables {
  accounts: Record<string, string>;
}

/** Fills `vault.accounts` once with rows whose hashed, encrypted and localized columns hold their stored form. */
export async function seedBrowseFixtures(): Promise<void> {
  const schema: StagedSchema<BrowseTables, unknown> | undefined = Schema.get("vault");
  if (!schema) return;
  const accounts = schema.instance().table("accounts");
  if ((await accounts.count().run()) > 0) return;
  await accounts
    .insert([
      { _id: "acc_ada", handle: "ada", password: ACCOUNT_PASSWORD, card_number: ACCOUNT_CARD, display_name: ACCOUNT_NAME_LONG },
      { _id: "acc_bob", handle: "bob", password: "$argon2id$v=19$stored-hash-of-bob", card_number: "enc:v1:stored-cipher-of-bob", display_name: "Bob" },
    ], { conflict: "update" })
    .run();
}
