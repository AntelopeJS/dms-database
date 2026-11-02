import { strict as assert } from "node:assert";
import type { FieldType } from "@antelopejs/interface-database/schema";
import { toFieldDescriptor } from "../service/fieldDescriptor";

const untaggedCodec: FieldType = {
  _A: undefined,
  _O: undefined,
  _I: undefined,
  name: "Untagged",
  is: () => true,
  encode: () => undefined,
  decode: () => ({ _tag: "Right" }),
};

describe("the field descriptors of a schema", () => {
  it("describes the string field types", () => {
    assert.deepEqual(toFieldDescriptor("number"), { kind: "number" });
    assert.deepEqual(toFieldDescriptor(["date"]), {
      kind: "array",
      element: { kind: "date" },
    });
    assert.deepEqual(toFieldDescriptor({ born: "date", tags: ["string"] }), {
      kind: "object",
      fields: {
        born: { kind: "date" },
        tags: { kind: "array", element: { kind: "string" } },
      },
    });
  });

  it("describes a codec without a tag by its own properties", () => {
    const descriptor = toFieldDescriptor(untaggedCodec);
    assert.equal(descriptor.kind, "object");
    assert.deepEqual(descriptor.kind === "object" && descriptor.fields.is, {
      kind: "unknown",
    });
    assert.deepEqual(descriptor.kind === "object" && descriptor.fields._A, {
      kind: "unknown",
    });
  });
});
