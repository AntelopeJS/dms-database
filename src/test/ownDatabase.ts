import { type Db, MongoClient } from "mongodb";

/** The database the harness's `mongodb` module stores the module's own tables in. */
export const OWN_DATABASE_NAME = "dms-database-test";

/** The variable the harness's setup sets to the replica set's root connection string. */
export const OWN_DATABASE_URL_VARIABLE = "DMS_DATABASE_TEST_MONGO_URL";

/**
 * Runs `body` on the harness's own database through a client of its own, for
 * a test that changes what the driver cannot (a collection's options).
 *
 * @param body What to do on the database
 * @returns What `body` resolves to
 */
export async function withOwnDatabase<T>(
  body: (db: Db) => Promise<T>,
): Promise<T> {
  const url = process.env[OWN_DATABASE_URL_VARIABLE];
  if (!url) throw new Error(`${OWN_DATABASE_URL_VARIABLE} is not set`);
  const client = await MongoClient.connect(url);
  try {
    return await body(client.db(OWN_DATABASE_NAME));
  } finally {
    await client.close();
  }
}
