import { type AntelopeConfig, defineConfig } from "@antelopejs/interface-core/config";

const preferredApiPort = process.env.PORT ?? "5010";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

type Tone = "primary" | "secondary" | "success" | "info" | "warning" | "error" | "neutral";

interface SchemaLabelConfig {
  label: string;
  color?: Tone;
}

interface DatabaseConfig {
  driverLabel?: string;
  schemaLabels?: Record<string, SchemaLabelConfig>;
  externalConnections?: Record<string, { access?: "read" | "read-write" }>;
}

const DATABASE = "@antelopejs/interface-database";
const CATALOG = "@antelopejs/interface-database-catalog";

const TONES: readonly Tone[] = ["primary", "secondary", "success", "info", "warning", "error", "neutral"];

/** `key:Label:tone`, labels separated by `;`, the tone left out for none. */
function parseSchemaLabels(text: string) {
  return Object.fromEntries(
    text.split(";").map((spec) => {
      const [key = "", label = "", tone] = spec.split(":");
      return [key, { label, color: TONES.find((candidate) => candidate === tone) }] as const;
    }),
  );
}

/**
 * The folder `VERIFY_DATABASE_PROJECT_ROOT` names is the project the DMS configuration writer reads and rewrites
 * instead of this one: this file holds its modules in a spread, which the writer cannot rewrite.
 *
 * The module's options, each from a `VERIFY_DATABASE_*` variable a journey sets
 * in the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults.
 */
function databaseConfig(): DatabaseConfig {
  const env = process.env;
  const config: DatabaseConfig = {};
  if (env.VERIFY_DATABASE_DRIVER_LABEL) config.driverLabel = env.VERIFY_DATABASE_DRIVER_LABEL;
  if (env.VERIFY_DATABASE_SCHEMA_LABELS) config.schemaLabels = parseSchemaLabels(env.VERIFY_DATABASE_SCHEMA_LABELS);
  if (env.VERIFY_DATABASE_EXTERNAL) config.externalConnections = { erp: { access: "read" } };
  return config;
}

/** Pins the project's own database for a module that imports the database interface once `erp` is a second instance of it. */
function ownDatabase() {
  return process.env.VERIFY_DATABASE_EXTERNAL ? [{ interface: DATABASE, source: "mongodb" }] : [];
}

/**
 * The module's `importOverrides`: the project's own database first, then, while `VERIFY_DATABASE_EXTERNAL` is set,
 * the `erp` connection the connect flow wires, read and written through `mongodb-erp` and described by its catalog.
 */
function databaseOverrides() {
  const own = [{ interface: DATABASE, source: "mongodb" }];
  if (!process.env.VERIFY_DATABASE_EXTERNAL) return own;
  return [...own, { interface: DATABASE, source: "mongodb-erp", id: "erp" }, { interface: CATALOG, source: "mongodb-erp", id: "erp" }];
}

/**
 * The external `erp` database, a second `@antelopejs/mongodb` in external mode on the run's MongoDB and the tables
 * module that declares its `customers` table, loaded only while `VERIFY_DATABASE_EXTERNAL` is set. The `customers`
 * collection must exist before the backend starts: `POST /verify-database-erp/seed` writes it.
 */
function externalModules(): NonNullable<AntelopeConfig["modules"]> {
  if (!process.env.VERIFY_DATABASE_EXTERNAL) return {};
  return {
    "mongodb-erp": {
      source: { type: "local", path: "../../node_modules/@antelopejs/mongodb" },
      config: { url: process.env.MONGO_URL ?? "mongodb://localhost:27017", database: "erp", mode: "external", catalog: { enabled: true } },
      exportPriority: { [DATABASE]: -1 },
    },
    "erp-tables": {
      source: { type: "local", path: "erp-tables" },
      importOverrides: [{ interface: DATABASE, source: "mongodb-erp" }],
    },
  };
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `e2e/stack.ts` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-database",
  modules: {
    app: {
      source: { type: "local", path: "." },
      importOverrides: ownDatabase(),
    },
    "dms-database": {
      source: { type: "local", path: "../.." },
      config: databaseConfig(),
      importOverrides: databaseOverrides(),
    },
    ...externalModules(),
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: "0.25.0",
      },
      importOverrides: ownDatabase(),
      config: {
        homepage: "/modules/database/overview",
        meta: { title: "AntelopeJS Database", description: "Database verification" },
        auth: {
          jwtSecret: process.env.DMS_JWT_SECRET ?? "dev",
          signInCountry: { database: false },
        },
        htmlRender: {
          serviceSecret: process.env.DMS_HTML_RENDER_SECRET ?? "dev",
          renderEndpoint: dmsClientUrl && `${dmsClientUrl}/api/html/render`,
        },
        apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}",
        clientBaseUrl: dmsClientUrl,
        frontend: { bootstrapSecret: process.env.DMS_BOOTSTRAP_SECRET },
        docsPreview: true,
        builder: process.env.VERIFY_DATABASE_PROJECT_ROOT ? { projectRoot: process.env.VERIFY_DATABASE_PROJECT_ROOT } : undefined,
      },
    },
    mongodb: {
      source: { type: "local", path: "../../node_modules/@antelopejs/mongodb" },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "verify_dms_database",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.1.3",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.2.2 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.13 <1.0.0",
      },
      config: {
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.7.8",
      },
      config: {
        servers: [{ protocol: "http", port: preferredApiPort }],
        publicBaseUrl: process.env.DMS_CLIENT_BASE_URL,
        cors: {
          allowedOrigins: [process.env.DMS_CLIENT_BASE_URL ?? "http://localhost:3001"],
        },
      },
    },
  },
});
