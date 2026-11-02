import { strict as assert } from "node:assert";
import { toFieldDescriptor } from "../service/fieldDescriptor";

const untaggedCodec = {
  _A: undefined,
  _O: undefined,
  _I: undefined,
  name: "Untagged",
  is: () => true,
  encode: () => undefined,
  decode: () => ({ _tag: "Right" as const }),
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

  it("describes a property of an untagged codec that holds a non-string leaf as unknown", () => {
    const codec = {
      ...untaggedCodec,
      mixed: ["string", () => 1],
      plain: ["string", "date"],
    };
    const descriptor = toFieldDescriptor(codec);
    assert.equal(descriptor.kind, "object");
    assert.deepEqual(descriptor.kind === "object" && descriptor.fields.mixed, {
      kind: "unknown",
    });
    assert.deepEqual(descriptor.kind === "object" && descriptor.fields.plain, {
      kind: "array",
      element: { kind: "string" },
    });
  });

  it("describes a record property of an untagged codec by its leaves", () => {
    const codec = {
      ...untaggedCodec,
      badRecord: { a: "string", b: () => 1 },
      goodRecord: { a: "string", b: "date" },
    };
    const descriptor = toFieldDescriptor(codec);
    assert.equal(descriptor.kind, "object");
    assert.deepEqual(
      descriptor.kind === "object" && descriptor.fields.badRecord,
      {
        kind: "unknown",
      },
    );
    assert.deepEqual(
      descriptor.kind === "object" && descriptor.fields.goodRecord,
      {
        kind: "object",
        fields: { a: { kind: "string" }, b: { kind: "date" } },
      },
    );
  });
});
