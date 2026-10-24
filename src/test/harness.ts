import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const API_PORT = 5023;
const JWT_SECRET = "test-jwt-secret";
const HTML_RENDER_SECRET = "test-html-render-secret";
const MONGO_BINARY_VERSION = "8.0.8";

let mongod: MongoMemoryReplSet;
let storageDir: string;

export default defineConfig({
  name: "dms-database-test",
  cacheFolder: ".antelope/cache",
  logging: {
    channelFilter: {
      "*": "warn",
    },
  },
  modules: {
    local: {
      source: {
        type: "local",
        path: ".",
        // CI builds once before the suite and sets DMS_PREBUILT; locally the
        // harness keeps rebuilding so a run always tests the current sources.
        installCommand: process.env.DMS_PREBUILT ? [] : ["pnpm build"],
      },
      config: {},
    },
    dms: {
      source: process.env.DMS_SOURCE
        ? {
            type: "local",
            path: process.env.DMS_SOURCE,
          }
        : {
            type: "package",
            package: "@antelopejs/dms",
            version: ">=0.11.0 <1.0.0",
          },
      config: {
        // No frontend server runs here: the dashboard URL is the API, whose
        // paths the front proxy serves unchanged.
        clientBaseUrl: `http://127.0.0.1:${API_PORT}`,
        auth: {
          jwtSecret: JWT_SECRET,
        },
        // Outside development, which the test run is not, dms 0.11 refuses
        // to start without a render secret of its own.
        htmlRender: {
          serviceSecret: HTML_RENDER_SECRET,
        },
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "1.5.0",
      },
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "1.0.3",
      },
      config: {
        secret: JWT_SECRET,
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "0.1.13",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "0.0.6",
      },
      config: {
        host: "127.0.0.1",
        port: 0,
        secure: false,
        defaults: { from: "dms-database@test.local" },
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "1.5.0",
      },
      config: {
        servers: [{ protocol: "http", host: "127.0.0.1", port: API_PORT }],
        publicBaseUrl: `http://127.0.0.1:${API_PORT}`,
      },
    },
  },
  test: {
    folder: "dist/test",
    async setup() {
      mongod = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        binary: { version: MONGO_BINARY_VERSION },
      });
      storageDir = await mkdtemp(join(tmpdir(), "dms-database-test-storage-"));
      return {
        modules: {
          mongodb: {
            config: { url: mongod.getUri(), database: "dms-database-test" },
          },
          "file-storage-local": {
            config: {
              storagePath: storageDir,
              baseUrl: `http://127.0.0.1:${API_PORT}`,
              defaultVisibility: "private",
            },
          },
        },
      };
    },
    async cleanup() {
      // Awaited inside ajs's finally: a rejection here would replace the run's
      // real outcome with a teardown stack.
      try {
        if (mongod) await mongod.stop();
      } catch (error) {
        console.warn("failed to stop the in-memory mongo", error);
      }
      try {
        if (storageDir) await rm(storageDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("failed to remove the temporary storage", error);
      }
    },
  },
});
