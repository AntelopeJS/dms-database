import { defineConfig } from "@antelopejs/interface-core/config";

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
}

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
 * The module's options, each from a `VERIFY_DATABASE_*` variable a journey sets
 * in the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults.
 */
function databaseConfig(): DatabaseConfig {
  const env = process.env;
  const config: DatabaseConfig = {};
  if (env.VERIFY_DATABASE_DRIVER_LABEL) config.driverLabel = env.VERIFY_DATABASE_DRIVER_LABEL;
  if (env.VERIFY_DATABASE_SCHEMA_LABELS) config.schemaLabels = parseSchemaLabels(env.VERIFY_DATABASE_SCHEMA_LABELS);
  return config;
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `dms-control` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-database",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-database": {
      source: { type: "local", path: "../../../.." },
      config: databaseConfig(),
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.11.0 <1.0.0",
      },
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
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.5.0",
      },
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
        version: "^1.0.3",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.1.13 <1.0.0",
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
        version: ">=0.0.6 <1.0.0",
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
        version: "^1.5.0",
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
