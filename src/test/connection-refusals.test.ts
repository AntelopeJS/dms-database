import { strict as assert } from "node:assert";
import { CONNECTION_REFUSALS } from "../service/connectionRefusals";
import { localeFiles, localeMessage } from "./helpers/locales";

describe("the refusals of the connections, the Data browser's edits and the relation routes", () => {
  it("each name a sentence every dashboard locale holds, which the toast shows instead of the generic failure", () => {
    const files = localeFiles();
    assert.deepEqual(files, ["database-en-GB.json", "database-fr-FR.json"]);
    const missing = files.flatMap((file) =>
      Object.values(CONNECTION_REFUSALS)
        .filter(
          (key) =>
            !key.startsWith("$") ||
            localeMessage(file, key.slice(1)) === undefined,
        )
        .map((key) => `${file}: ${key}`),
    );
    assert.deepEqual(missing, []);
  });

  it("keep the placeholder of the value each refusal sends in every locale, which a sentence dropping the database's name or the writer's reason gets wrong", () => {
    const placeholders = [
      [CONNECTION_REFUSALS.readOnlyConnection, "{connection}"],
      [CONNECTION_REFUSALS.catalogTimedOut, "{connection}"],
      [CONNECTION_REFUSALS.catalogRefused, "{connection}"],
      [CONNECTION_REFUSALS.builderRefused, "{reason}"],
    ] as const;
    const missing = localeFiles().flatMap((file) =>
      placeholders
        .filter(
          ([key, placeholder]) =>
            !localeMessage(file, key.slice(1))?.includes(placeholder),
        )
        .map(([key, placeholder]) => `${file}: ${key} ${placeholder}`),
    );
    assert.deepEqual(missing, []);
  });
});
