export type FieldDescriptor =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "unknown" }
  | { kind: "any" }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "union"; members: FieldDescriptor[] }
  | { kind: "intersection"; members: FieldDescriptor[] }
  | { kind: "array"; element?: FieldDescriptor }
  | { kind: "tuple"; elements: FieldDescriptor[] }
  | {
      kind: "object";
      fields: Record<string, FieldDescriptor>;
      partial?: boolean;
    }
  | { kind: "record"; key?: FieldDescriptor; value: FieldDescriptor }
  | { kind: "keyof"; keys: string[] }
  | { kind: "refinement"; base: FieldDescriptor; name: string }
  | { kind: "recursive"; name: string };

interface CodecLike {
  readonly _tag?: string;
  readonly name?: string;
  readonly type?: unknown;
  readonly types?: unknown;
  readonly value?: unknown;
  readonly codomain?: unknown;
  readonly domain?: unknown;
  readonly props?: Record<string, unknown>;
  readonly keys?: Record<string, unknown>;
  decode(i: unknown): unknown;
}

function isCodec(value: unknown): value is CodecLike {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.decode === "function" && "_tag" in obj;
}

function codecMembers(value: unknown): CodecLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCodec) as CodecLike[];
}

type CodecDescriptorHandler = (codec: CodecLike) => FieldDescriptor;

function literalDescriptor(codec: CodecLike): FieldDescriptor {
  const v = codec.value;
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return { kind: "literal", value: v };
  }
  return { kind: "unknown" };
}

function unionDescriptor(codec: CodecLike): FieldDescriptor {
  return {
    kind: "union",
    members: codecMembers(codec.types).map(codecToDescriptor),
  };
}

function intersectionDescriptor(codec: CodecLike): FieldDescriptor {
  return {
    kind: "intersection",
    members: codecMembers(codec.types).map(codecToDescriptor),
  };
}

function arrayDescriptor(codec: CodecLike): FieldDescriptor {
  const inner = isCodec(codec.type) ? codecToDescriptor(codec.type) : undefined;
  return { kind: "array", element: inner };
}

function tupleDescriptor(codec: CodecLike): FieldDescriptor {
  return {
    kind: "tuple",
    elements: codecMembers(codec.types).map(codecToDescriptor),
  };
}

function objectDescriptor(codec: CodecLike): FieldDescriptor {
  const props =
    (codec.props as Record<string, unknown> | undefined) ??
    (isCodec(codec.type)
      ? ((codec.type as CodecLike).props as Record<string, unknown> | undefined)
      : undefined);
  const fields: Record<string, FieldDescriptor> = {};
  if (props) {
    for (const [name, sub] of Object.entries(props)) {
      if (isCodec(sub)) fields[name] = codecToDescriptor(sub);
    }
  }
  const partial =
    codec._tag === "PartialType" ||
    (codec._tag === "ExactType" &&
      isCodec(codec.type) &&
      (codec.type as CodecLike)._tag === "PartialType");
  return partial
    ? { kind: "object", fields, partial: true }
    : { kind: "object", fields };
}

function recordDescriptor(codec: CodecLike): FieldDescriptor {
  const valueCodec = isCodec(codec.codomain)
    ? codecToDescriptor(codec.codomain)
    : { kind: "unknown" as const };
  const keyCodec = isCodec(codec.domain)
    ? codecToDescriptor(codec.domain)
    : undefined;
  return { kind: "record", key: keyCodec, value: valueCodec };
}

function keyofDescriptor(codec: CodecLike): FieldDescriptor {
  const keys = codec.keys ? Object.keys(codec.keys) : [];
  return { kind: "keyof", keys };
}

function refinementDescriptor(codec: CodecLike): FieldDescriptor {
  const base = isCodec(codec.type)
    ? codecToDescriptor(codec.type)
    : { kind: "unknown" as const };
  return { kind: "refinement", base, name: codec.name ?? "refinement" };
}

function recursiveDescriptor(codec: CodecLike): FieldDescriptor {
  return { kind: "recursive", name: codec.name ?? "recursive" };
}

const CODEC_DESCRIPTORS: Record<string, CodecDescriptorHandler> = {
  StringType: () => ({ kind: "string" }),
  NumberType: () => ({ kind: "number" }),
  BooleanType: () => ({ kind: "boolean" }),
  NullType: () => ({ kind: "null" }),
  UndefinedType: () => ({ kind: "undefined" }),
  VoidType: () => ({ kind: "undefined" }),
  AnyType: () => ({ kind: "any" }),
  UnknownType: () => ({ kind: "unknown" }),
  LiteralType: literalDescriptor,
  UnionType: unionDescriptor,
  IntersectionType: intersectionDescriptor,
  ArrayType: arrayDescriptor,
  ReadonlyArrayType: arrayDescriptor,
  AnyArrayType: arrayDescriptor,
  TupleType: tupleDescriptor,
  InterfaceType: objectDescriptor,
  PartialType: objectDescriptor,
  ExactType: objectDescriptor,
  ReadonlyType: objectDescriptor,
  DictionaryType: recordDescriptor,
  AnyDictionaryType: recordDescriptor,
  KeyofType: keyofDescriptor,
  RefinementType: refinementDescriptor,
  RecursiveType: recursiveDescriptor,
};

export function codecToDescriptor(codec: CodecLike): FieldDescriptor {
  const handler = codec._tag ? CODEC_DESCRIPTORS[codec._tag] : undefined;
  if (handler) return handler(codec);
  if (codec.name === "Date") return { kind: "date" };
  return { kind: "unknown" };
}

const STRING_FIELD_DESCRIPTORS: Record<string, () => FieldDescriptor> = {
  string: () => ({ kind: "string" }),
  number: () => ({ kind: "number" }),
  boolean: () => ({ kind: "boolean" }),
  date: () => ({ kind: "date" }),
  any: () => ({ kind: "any" }),
  unknown: () => ({ kind: "unknown" }),
};

export function stringFieldTypeToDescriptor(value: unknown): FieldDescriptor {
  if (typeof value === "string") {
    const build = STRING_FIELD_DESCRIPTORS[value];
    return build ? build() : { kind: "unknown" };
  }
  if (Array.isArray(value)) {
    const first = value[0];
    const element =
      first === undefined ? undefined : stringFieldTypeToDescriptor(first);
    return { kind: "array", element };
  }
  if (value !== null && typeof value === "object") {
    const fields: Record<string, FieldDescriptor> = {};
    for (const [name, sub] of Object.entries(
      value as Record<string, unknown>,
    )) {
      fields[name] = stringFieldTypeToDescriptor(sub);
    }
    return { kind: "object", fields };
  }
  return { kind: "unknown" };
}

// `InterfaceFieldType | unknown` collapsed to `unknown`, so the union only
// documented the intent. It says so in words instead.
export function toFieldDescriptor(value: unknown): FieldDescriptor {
  if (isCodec(value)) return codecToDescriptor(value);
  return stringFieldTypeToDescriptor(value);
}
