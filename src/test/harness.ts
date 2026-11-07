import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const API_PORT = 5023;
const JWT_SECRET = "test-jwt-secret";
const HTML_RENDER_SECRET = "test-html-render-secret";
const MONGO_BINARY_VERSION = "8.0.8";
const DMS_RANGE = ">=0.16.1 <1.0.0";

/**
 * Orders two release versions (`major.minor.patch`, no prerelease).
 *
 * @param left A version
 * @param right Another version
 * @returns A negative number when `left` is older, positive when newer, 0 when equal
 */
function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The newest published `@antelopejs/dms` in {@link DMS_RANGE}, read from the
 * registry. CI restores `.antelope/cache`, so there the loader gets this exact
 * version and never falls back to an older cached copy: an unreachable
 * registry fails the run instead. Local runs keep the range.
 *
 * @returns The version
 */
function newestDms(): string {
  const output = execFileSync(
    "npm",
    ["view", `@antelopejs/dms@${DMS_RANGE}`, "version", "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const parsed: unknown = JSON.parse(output);
  const versions = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (value): value is string => typeof value === "string",
  );
  const newest = versions.reduce<string | undefined>(
    (best, version) =>
      best === undefined || compareVersions(version, best) > 0 ? version : best,
    undefined,
  );
  if (newest === undefined)
    throw new Error(`no @antelopejs/dms version matches ${DMS_RANGE}`);
  return newest;
}

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
            version: process.env.CI ? newestDms() : DMS_RANGE,
          },
      config: {
        /**
         * No frontend server runs here: the dashboard URL is the API, whose
         * paths the front proxy serves unchanged.
         */
        clientBaseUrl: `http://127.0.0.1:${API_PORT}`,
        auth: {
          jwtSecret: JWT_SECRET,
        },
        /**
         * Outside development, which the test run is not, dms 0.11 refuses
         * to start without a render secret of its own.
         */
        htmlRender: {
          serviceSecret: HTML_RENDER_SECRET,
        },
      },
    },
    mongodb: {
      source: { type: "local", path: "node_modules/@antelopejs/mongodb" },
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "1.1.0",
      },
      config: {
        secret: JWT_SECRET,
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "0.2.0",
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
        version: "1.7.0",
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
      /**
       * Awaited inside ajs's finally: a rejection here would replace the run's
       * real outcome with a teardown stack.
       */
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
