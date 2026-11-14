import { strict as assert } from "node:assert";
import { CONNECTION_REFUSALS } from "../service/connectionRefusals";
import { localeFiles, localeMessage } from "./helpers/locales";

describe("the refusals of the database switcher and the access switch", () => {
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
});
