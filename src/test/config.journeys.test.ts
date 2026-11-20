import { strict as assert } from "node:assert";
import { Schema } from "@antelopejs/interface-database";
import { getModuleConfig, setModuleConfig } from "../config";
import { callDatabase } from "./helpers/http";
import { objectsAt, text } from "./helpers/pick";
import { createOwnerSession, type OwnerSession } from "./ownerSession";
import { LOADED_HOST_TIMEOUT_MS } from "./helpers/timeouts";

/**
 * The schemas whose badge each journey reads, with the label and tone the Overview feed must give them under the
 * harness's `schemaLabels` (`schemaLabelConfig.ts`). `none/primary` is a schema with no label.
 */
const BUILT_IN = {
  "app-cfgj6": "Application/info",
  "core-cfgj6": "Core/primary",
  "global-cfgj6": "Global/neutral",
  "staging-cfgj6": "Staging/warning",
  "reviews-cfgj6": "Reviews/secondary",
  "production-cfgj6": "Production/success",
  "billing-cfgj6": "none/primary",
  "tenant-acme-cfgj6": "none/primary",
  "shop-cfgj6": "none/primary",
};

/** With no `schemaLabels`, the schemas the option labels fall back to their built-in label or to none. */
const UNCONFIGURED = {
  ...BUILT_IN,
  "core-cfgj7": "Core/primary",
  "app-site-cfgj7": "Application/info",
  "tenant-acme-cfgj7": "none/primary",
};

const RESOLUTION_ORDER = {
  "tenant-acme-cfgj7": "Acme/error",
  "core-cfgj7": "Kernel/neutral",
  "billing-cfgj7": "Billing/success",
  "app-site-cfgj7": "Apps/secondary",
  "global-cfgj7": "Global/neutral",
  "shop-cfgj7": "none/primary",
  "tenant-x-acme-cfgj7": "Tenant data/warning",
  "tenant-acme-cfgj7o": "Late/info",
};

const WHOLE_ID = {
  "app-cfgj8p-site": "Application/info",
  "tenant-cfgj8p-acme": "none/primary",
  "app-cfgj8w-site": "Whole/error",
  "tenant-cfgj8w-acme": "Whole/warning",
};

const SCHEMAS = [BUILT_IN, RESOLUTION_ORDER, WHOLE_ID].flatMap((expected) =>
  Object.keys(expected).map(
    (id) =>
      new Schema<{ rows: { _id: string } }>(id, {
        rows: { fields: { _id: "string" }, indexes: {} },
      }),
  ),
);

/** The badge of each schema of `expected`, read from the Overview feed as "label/tone". */
async function badges(
  owner: OwnerSession,
  expected: Record<string, string>,
): Promise<Record<string, string | undefined>> {
  const feed = await callDatabase(owner, "GET", "/overview/schemas");
  assert.equal(feed.status, 200, feed.text);
  const found = new Map(
    objectsAt(feed.body, "items").map((card) => [
      text(card.id),
      `${text(card.description) || "none"}/${text(card.iconTone)}`,
    ]),
  );
  return Object.fromEntries(
    Object.keys(expected).map((id) => [id, found.get(id)]),
  );
}

describe("[integration] config journeys", function () {
  this.timeout(LOADED_HOST_TIMEOUT_MS);

  let owner: OwnerSession;

  before(async () => {
    for (const schema of SCHEMAS) {
      await schema
        .createInstance()
        .run()
        .catch(() => undefined);
      await schema
        .instance()
        .table("rows")
        .insert([{ _id: "r1" }])
        .run();
    }
    owner = await createOwnerSession("config-journeys-owner@example.test");
  });

  after(async () => {
    await owner.remove();
    for (const schema of SCHEMAS) {
      await schema.instance().table("rows").delete().run();
    }
  });

  it("built-in-patterns-label-schemas-by-the-start-of-their-id", async () => {
    const configured = getModuleConfig();
    setModuleConfig({ ...configured, schemaLabels: undefined });
    try {
      assert.deepEqual(
        await badges(owner, UNCONFIGURED),
        UNCONFIGURED,
        "a built-in pattern that is missing, mis-toned or matches inside the id instead of at its start, or a label the removed option still gives",
      );
    } finally {
      setModuleConfig(configured);
    }
  });

  it("an-exact-key-beats-a-pattern-which-beats-a-built-in-label", async () => {
    assert.deepEqual(
      await badges(owner, RESOLUTION_ORDER),
      RESOLUTION_ORDER,
      "a pattern tried before the exact key, the built-in table before the option, or the last matching pattern kept instead of the first",
    );
  });

  it("a-glob-key-matches-the-whole-schema-id", async () => {
    assert.deepEqual(
      await badges(owner, WHOLE_ID),
      WHOLE_ID,
      "a pattern compiled without its ^ or $ anchor labels a schema it covers only part of",
    );
  });
});
