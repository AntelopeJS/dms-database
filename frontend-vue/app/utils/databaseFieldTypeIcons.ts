import type { FieldDescriptor } from "../composables/useDatabaseSchemas";

export interface TypeIcon {
	icon: string;
	color: string;
	label: string;
}

const NAMED_TYPE_ICONS: Record<string, TypeIcon> = {
	email: { icon: "i-ph-at", color: "text-sky-500", label: "Email" },
	password: { icon: "i-ph-lock", color: "text-amber-500", label: "Password" },
	secret: { icon: "i-ph-lock", color: "text-amber-500", label: "Secret" },
};

const FALLBACK_ICON: TypeIcon = {
	icon: "i-ph-question",
	color: "text-muted",
	label: "Unknown",
};

const STRING_ICON: TypeIcon = {
	icon: "i-ph-text-aa",
	color: "text-neutral-500",
	label: "String",
};
const NUMBER_ICON: TypeIcon = {
	icon: "i-ph-hash",
	color: "text-blue-500",
	label: "Number",
};
const BOOLEAN_ICON: TypeIcon = {
	icon: "i-ph-toggle-right",
	color: "text-emerald-500",
	label: "Boolean",
};
const DATE_ICON: TypeIcon = {
	icon: "i-ph-calendar-blank",
	color: "text-violet-500",
	label: "Date",
};
const ARRAY_ICON: TypeIcon = {
	icon: "i-ph-brackets-square",
	color: "text-orange-500",
	label: "Array",
};
const OBJECT_ICON: TypeIcon = {
	icon: "i-ph-brackets-curly",
	color: "text-amber-600",
	label: "Object",
};
const RECORD_ICON: TypeIcon = {
	icon: "i-ph-brackets-curly",
	color: "text-amber-600",
	label: "Record",
};
const TUPLE_ICON: TypeIcon = {
	icon: "i-ph-brackets-square",
	color: "text-orange-500",
	label: "Tuple",
};
const ENUM_ICON: TypeIcon = {
	icon: "i-ph-list-checks",
	color: "text-cyan-500",
	label: "Enum",
};
const UNION_ICON: TypeIcon = {
	icon: "i-ph-split",
	color: "text-fuchsia-500",
	label: "Union",
};
const NULL_ICON: TypeIcon = {
	icon: "i-ph-circle-dashed",
	color: "text-muted",
	label: "Null",
};

const PRIMARY_KEY_NAMES = new Set(["id", "_id"]);
const PRIMARY_KEY_INDEXES = ["pk", "primary"] as const;

function literalLabel(value: string | number | boolean): string {
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

function describeDescriptor(d: FieldDescriptor): string {
	switch (d.kind) {
		case "string":
		case "number":
		case "boolean":
		case "date":
		case "any":
		case "unknown":
		case "null":
		case "undefined":
			return d.kind;
		case "literal":
			return literalLabel(d.value);
		case "array":
			return `${d.element ? describeDescriptor(d.element) : "any"}[]`;
		case "tuple":
			return `[${d.elements.map(describeDescriptor).join(", ")}]`;
		case "object":
			return d.partial ? "Partial object" : "Object";
		case "record":
			return `Record<${d.key ? describeDescriptor(d.key) : "string"}, ${describeDescriptor(
				d.value,
			)}>`;
		case "union":
			return d.members.map(describeDescriptor).join(" | ");
		case "intersection":
			return d.members.map(describeDescriptor).join(" & ");
		case "keyof":
			return d.keys.length > 0 ? d.keys.map((k) => `"${k}"`).join(" | ") : "keyof";
		case "refinement":
			return d.name;
		case "recursive":
			return d.name;
	}
}

function descriptorIcon(d: FieldDescriptor): TypeIcon {
	switch (d.kind) {
		case "string":
			return STRING_ICON;
		case "number":
			return NUMBER_ICON;
		case "boolean":
			return BOOLEAN_ICON;
		case "date":
			return DATE_ICON;
		case "null":
		case "undefined":
			return NULL_ICON;
		case "any":
		case "unknown":
			return FALLBACK_ICON;
		case "array":
			return d.element
				? { ...ARRAY_ICON, label: `${describeDescriptor(d.element)}[]` }
				: ARRAY_ICON;
		case "tuple":
			return { ...TUPLE_ICON, label: describeDescriptor(d) };
		case "object":
			return d.partial ? { ...OBJECT_ICON, label: "Partial object" } : OBJECT_ICON;
		case "record":
			return { ...RECORD_ICON, label: describeDescriptor(d) };
		case "literal": {
			const base =
				typeof d.value === "string"
					? STRING_ICON
					: typeof d.value === "number"
						? NUMBER_ICON
						: BOOLEAN_ICON;
			return { ...base, label: literalLabel(d.value) };
		}
		case "union": {
			const allLiteral =
				d.members.length > 0 && d.members.every((m) => m.kind === "literal");
			if (allLiteral) {
				return { ...ENUM_ICON, label: describeDescriptor(d) };
			}
			return { ...UNION_ICON, label: describeDescriptor(d) };
		}
		case "intersection":
			return { ...UNION_ICON, label: describeDescriptor(d) };
		case "keyof":
			return { ...ENUM_ICON, label: describeDescriptor(d) };
		case "refinement": {
			const base = descriptorIcon(d.base);
			return { ...base, label: d.name };
		}
		case "recursive":
			return { ...FALLBACK_ICON, label: d.name };
	}
}

function isDescriptor(value: unknown): value is FieldDescriptor {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { kind?: unknown }).kind === "string"
	);
}

const RUNTIME_TYPE_ICONS: Record<string, TypeIcon> = {
	string: STRING_ICON,
	number: NUMBER_ICON,
	boolean: BOOLEAN_ICON,
	array: ARRAY_ICON,
	object: OBJECT_ICON,
	null: NULL_ICON,
	undefined: NULL_ICON,
};

// Icon for a COARSE RUNTIME type as sampled by the browse `/columns` endpoint
// (string | number | boolean | object | array | null | undefined) — the data
// grid's headers use this so runtime-sampled and schema-declared columns share
// one icon set. Named-field overrides (email, password…) still apply.
export function runtimeTypeIcon(type: string, fieldName: string): TypeIcon {
	const named = NAMED_TYPE_ICONS[fieldName.toLowerCase()];
	if (named) return named;
	return RUNTIME_TYPE_ICONS[type] ?? FALLBACK_ICON;
}

export function inferFieldTypeIcon(
	field: unknown,
	fieldName: string,
): TypeIcon {
	const named = NAMED_TYPE_ICONS[fieldName.toLowerCase()];
	if (named) return named;
	if (isDescriptor(field)) return descriptorIcon(field);
	return FALLBACK_ICON;
}

export function isPrimaryKey(
	fieldName: string,
	indexes: Record<string, { fields?: string[] }>,
): boolean {
	if (PRIMARY_KEY_NAMES.has(fieldName)) return true;
	for (const indexName of PRIMARY_KEY_INDEXES) {
		if (indexes[indexName]?.fields?.includes(fieldName)) return true;
	}
	return false;
}
