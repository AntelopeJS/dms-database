/// <reference types="node" />
import {
  type AntelopeModuleConfig,
  defineConfig,
} from "@antelopejs/interface-core/config";

const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;
const DATABASE_NAME = "playground_dms_database";

interface PlaygroundDatabase {
  label: string;
  module: AntelopeModuleConfig;
}

/** The database module the playground runs on, picked by `PLAYGROUND_DATABASE`. */
function playgroundDatabase(kind: string): PlaygroundDatabase {
  switch (kind) {
    case "mongodb":
      return {
        label: "MongoDB 6.0",
        module: {
          source: {
            type: "package",
            package: "@antelopejs/mongodb",
            version: "^1.6.2",
          },
          config: {
            url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
            database: DATABASE_NAME,
          },
          importOverrides: [],
          disabledExports: [],
        },
      };
    case "postgres":
      return {
        label: "PostgreSQL",
        module: {
          source: {
            type: "package",
            package: "@antelopejs/postgres",
            version: ">=0.2.5 <1.0.0",
          },
          config: {
            url:
              process.env.POSTGRES_URL ??
              `postgres://postgres@localhost:5432/${DATABASE_NAME}`,
          },
          importOverrides: [],
          disabledExports: [],
        },
      };
    default:
      throw new Error(
        `PLAYGROUND_DATABASE is "${kind}"; use "mongodb" or "postgres"`,
      );
  }
}

const databaseKind = process.env.PLAYGROUND_DATABASE || "mongodb";
const database = playgroundDatabase(databaseKind);

export default defineConfig({
  name: "playground",
  modules: {
    playground: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["pnpm build"],
      },
    },
    "dms-database": {
      source: {
        type: "local",
        path: "..",
        watchDir: ["src"],
        installCommand: ["pnpm build"],
      },
      config: {
        driverLabel: database.label,
      },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.16.1 <1.0.0",
      },
      config: {
        homepage: "/modules/database/overview",
        auth: {
          jwtSecret: "dev",
        },
      },
      importOverrides: [],
      disabledExports: [],
    },
    [databaseKind]: database.module,
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.1.0",
      },
      config: {
        secret: "dev",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.2.0 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "http://127.0.0.1:5010",
        defaultVisibility: "private",
      },
      importOverrides: [],
      disabledExports: [],
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.6 <1.0.0",
      },
      config: {
        ethereal: true,
      },
      importOverrides: [],
      disabledExports: [],
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.7.0",
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: "5010",
          },
        ],
        cors: {
          allowedOrigins: [
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            /^https:\/\/[^/]+\.onamp\.dev$/,
            ...(dmsClientUrl ? [dmsClientUrl] : []),
          ],
        },
      },
      importOverrides: [],
      disabledExports: [],
    },
  },
});
