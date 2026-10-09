import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const API_PORT = 5023;
const JWT_SECRET = "test-jwt-secret";
const MONGO_BINARY_VERSION = "8.0.8";

let mongod: MongoMemoryReplSet;
let storageDir: string;

// file-storage-local 0.1.6 fsyncs every directory it creates, walking up from the
// path to the parent of the first one `mkdir({ recursive: true })` created. On
// Windows, Node returns that first path as `\\?\C:\…` while the walk compares it
// with plain `C:\…` paths, so the walk never meets it: it climbs to `C:\` and loops
// there forever, and the module's construct never resolves. When the folders
// already exist, mkdir returns undefined and the walk is skipped.
const STORAGE_FOLDERS = [
  "files",
  "metadata",
  "__staging__",
  "tokens/upload",
  "tokens/read",
  "tokens/consumed",
];

async function precreateStorageLayout(root: string): Promise<void> {
  await Promise.all(
    STORAGE_FOLDERS.map((folder) =>
      mkdir(join(root, folder), { recursive: true }),
    ),
  );
}

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
        installCommand: ["pnpm build"],
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
            version: ">=0.6.0 <0.7.0",
          },
      config: {
        auth: {
          jwtSecret: JWT_SECRET,
        },
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "1.4.2",
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
        version: "0.1.6",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "0.0.5",
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
        version: "1.3.3",
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
      await precreateStorageLayout(storageDir);
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
