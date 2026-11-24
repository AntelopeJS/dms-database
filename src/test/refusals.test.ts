import { strict as assert } from "node:assert";
import { REFUSALS } from "../service/refusals";
import { localeFiles, localeMessage } from "./helpers/locales";

describe("the module's refusals", () => {
  it("each name a sentence every dashboard locale holds, with a placeholder for each param it sends and none it does not, which the toast shows instead of the generic failure", () => {
    const files = localeFiles();
    assert.deepEqual(files, ["database-en-GB.json", "database-fr-FR.json"]);
    const wrong = files.flatMap((file) =>
      Object.values(REFUSALS).flatMap(({ key, params }) => {
        const sentence = localeMessage(file, key.slice(1));
        const placeholders = [
          ...new Set(
            [...(sentence ?? "").matchAll(/\{(\w+)\}/g)].map(
              ([, name]) => name,
            ),
          ),
        ].sort();
        return sentence !== undefined &&
          placeholders.join() === [...params].sort().join()
          ? []
          : [`${file}: ${key} ${sentence ?? "missing"}`];
      }),
    );
    assert.deepEqual(wrong, []);
  });
});
