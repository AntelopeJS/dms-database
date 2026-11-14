import { MongoClient } from "mongodb";
import { version as PROVIDER_VERSION } from "@antelopejs/mongodb/package.json";

const DATABASE = "@antelopejs/interface-database";
const CATALOG = "@antelopejs/interface-database-catalog";
const ROOT_NAME = "dms-database-root";
const ROOT_PASSWORD = "dms-database-root-password";

/** A row the seed writes, keyed by `_id` as both providers alias it. */
interface SeedRow {
  _id: string;
  [field: string]: string | number;
}

/** One external database: its connection, provider, account and rows. */
interface ExternalDatabase {
  id: string;
  provider: string;
  database: string;
  user: string;
  role: "read" | "readWrite";
  seed: Record<string, SeedRow[]>;
}

/**
 * The external databases as the connect flow wires them: a provider in
 * external mode per database, named by one connection id, its account
 * holding the role the test needs.
 */
const EXTERNAL: ExternalDatabase[] = [
  {
    id: "erp",
    provider: "mongodb-erp",
    database: "erp",
    user: "erp-writer",
    role: "readWrite",
    seed: {
      customers: [
        { _id: "c1", name: "Ada", segment: "retail" },
        { _id: "c2", name: "Grace", segment: "wholesale" },
      ],
    },
  },
  {
    id: "archive",
    provider: "mongodb-archive",
    database: "archive",
    user: "archive-reader",
    role: "read",
    seed: { invoices: [{ _id: "i1", amount: 42 }] },
  },
];

/** Access control on, with a root account and one account per external database. */
export const MONGO_AUTH = {
  enable: true,
  customRootName: ROOT_NAME,
  customRootPwd: ROOT_PASSWORD,
  extraUsers: EXTERNAL.map(({ user, role, database }) => ({
    createUser: user,
    pwd: `${user}-password`,
    roles: [{ role, db: database }],
  })),
};

/**
 * A connection string signed in as an account of the admin database.
 *
 * @param uri The replica set's connection string
 * @param user The account
 * @param password Its password
 * @returns The connection string
 */
function signedIn(uri: string, user: string, password: string): string {
  const url = new URL(uri);
  url.username = user;
  url.password = password;
  url.searchParams.set("authSource", "admin");
  return url.toString();
}

/** The replica set's connection string as the root account. */
export function rootUri(uri: string): string {
  return signedIn(uri, ROOT_NAME, ROOT_PASSWORD);
}

/**
 * Writes the external databases' rows before the providers start: in
 * external mode one registers only collections the database already has.
 *
 * @param uri The replica set's connection string
 */
export async function seedExternalDatabases(uri: string): Promise<void> {
  const client = await MongoClient.connect(rootUri(uri));
  try {
    for (const { database, seed } of EXTERNAL) {
      for (const [collection, rows] of Object.entries(seed)) {
        await client
          .db(database)
          .collection<SeedRow>(collection)
          .insertMany(rows);
      }
    }
  } finally {
    await client.close();
  }
}

/**
 * The test's stand-in for the DMS configuration writer, which dms itself
 * implements since 0.20: dms-database writes its access through the stub.
 */
export const CONFIG_WRITER_STUB = {
  interface: "@antelopejs/interface-dms-builder",
  source: "dms-builder-stub",
};

/** The `importOverrides` the connect flow writes on the dms-database entry. */
export const DMS_DATABASE_OVERRIDES = [
  { interface: DATABASE, source: "mongodb" },
  ...EXTERNAL.flatMap(({ id, provider }) => [
    { interface: DATABASE, source: provider, id },
    { interface: CATALOG, source: provider, id },
  ]),
];

/**
 * A provider entry per external database, each a package source of the
 * `@antelopejs/mongodb` this repository tests with, the way the connect flow
 * writes it, and the tables module of `erp`.
 *
 * @returns The module entries by id
 */
export function externalModules() {
  const providers = EXTERNAL.map(
    ({ provider }) =>
      [
        provider,
        {
          source: {
            type: "package" as const,
            package: "@antelopejs/mongodb",
            version: PROVIDER_VERSION,
          },
          exportPriority: { [DATABASE]: -1 },
        },
      ] as const,
  );
  return {
    ...Object.fromEntries(providers),
    "erp-tables": {
      source: { type: "local" as const, path: "test-fixtures/erp-tables" },
      importOverrides: [{ interface: DATABASE, source: "mongodb-erp" }],
    },
    "dms-builder-stub": {
      source: {
        type: "local" as const,
        path: "test-fixtures/dms-builder-stub",
      },
    },
  };
}

/**
 * Each provider's configuration once the replica set runs: external mode,
 * signed in as the database's account, its catalog answering outside
 * development.
 *
 * @param uri The replica set's connection string
 * @returns The configuration by provider id
 */
export function externalModuleConfigs(uri: string) {
  return Object.fromEntries(
    EXTERNAL.map(({ provider, database, user }) => [
      provider,
      {
        config: {
          mode: "external",
          url: signedIn(uri, user, `${user}-password`),
          database,
          catalog: { enabled: true },
        },
      },
    ]),
  );
}
