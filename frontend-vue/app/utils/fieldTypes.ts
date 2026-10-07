import type { FieldDescriptor } from "../composables/useDatabaseSchemas";

// How a column's type reads in the inspector, the diagram and the grid: an
// icon and a mono label. Colour never encodes the type (D-09): it is kept for
// structure, primary keys and relations, which `columnRole` names.

export interface FieldTypeView {
	icon: string;
	label: string;
}

type DescriptorOf<K extends FieldDescriptor["kind"]> = Extract<
	FieldDescriptor,
	{ kind: K }
>;
type DescriptorViews = {
	[K in FieldDescriptor["kind"]]: (descriptor: DescriptorOf<K>) => FieldTypeView;
};

const UNKNOWN: FieldTypeView = { icon: "i-ph-question", label: "unknown" };
const STRING_ICON = "i-ph-text-aa";
const NUMBER_ICON = "i-ph-hash";
const BOOLEAN_ICON = "i-ph-toggle-right";
const LIST_ICON = "i-ph-brackets-square";
const OBJECT_ICON = "i-ph-brackets-curly";
const ENUM_ICON = "i-ph-list-checks";
const UNION_ICON = "i-ph-split";

const NAMED_FIELDS: Record<string, FieldTypeView> = {
	email: { icon: "i-ph-at", label: "email" },
	password: { icon: "i-ph-lock", label: "password" },
	secret: { icon: "i-ph-lock", label: "secret" },
};

const LITERAL_ICONS: Record<string, string> = {
	string: STRING_ICON,
	number: NUMBER_ICON,
	boolean: BOOLEAN_ICON,
};

function literalLabel(value: string | number | boolean): string {
	return typeof value === "string" ? `"${value}"` : String(value);
}

function label(descriptor: FieldDescriptor): string {
	return describeField(descriptor).label;
}

const VIEWS: DescriptorViews = {
	string: () => ({ icon: STRING_ICON, label: "string" }),
	number: () => ({ icon: NUMBER_ICON, label: "number" }),
	boolean: () => ({ icon: BOOLEAN_ICON, label: "boolean" }),
	date: () => ({ icon: "i-ph-calendar-blank", label: "date" }),
	any: () => ({ icon: "i-ph-asterisk", label: "any" }),
	unknown: () => UNKNOWN,
	null: () => ({ icon: "i-ph-circle-dashed", label: "null" }),
	undefined: () => ({ icon: "i-ph-circle-dashed", label: "undefined" }),
	literal: (d) => ({
		icon: LITERAL_ICONS[typeof d.value] ?? STRING_ICON,
		label: literalLabel(d.value),
	}),
	array: (d) => ({
		icon: LIST_ICON,
		label: `${d.element ? label(d.element) : "any"}[]`,
	}),
	tuple: (d) => ({
		icon: LIST_ICON,
		label: `[${d.elements.map(label).join(", ")}]`,
	}),
	object: (d) => ({ icon: OBJECT_ICON, label: d.partial ? "partial object" : "object" }),
	record: (d) => ({
		icon: OBJECT_ICON,
		label: `Record<${d.key ? label(d.key) : "string"}, ${label(d.value)}>`,
	}),
	union: (d) => ({
		icon:
			d.members.length > 0 && d.members.every((m) => m.kind === "literal")
				? ENUM_ICON
				: UNION_ICON,
		label: d.members.map(label).join(" | "),
	}),
	intersection: (d) => ({
		icon: UNION_ICON,
		label: d.members.map(label).join(" & "),
	}),
	keyof: (d) => ({
		icon: ENUM_ICON,
		label: d.keys.length > 0 ? d.keys.map((k) => `"${k}"`).join(" | ") : "keyof",
	}),
	refinement: (d) => ({ icon: describeField(d.base).icon, label: d.name }),
	recursive: (d) => ({ icon: UNKNOWN.icon, label: d.name }),
};

function isDescriptor(value: unknown): value is FieldDescriptor {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { kind?: unknown }).kind === "string" &&
		(value as { kind: string }).kind in VIEWS
	);
}

/** Icon and label of a schema-declared type. */
export function describeField(descriptor: unknown, fieldName = ""): FieldTypeView {
	const named = NAMED_FIELDS[fieldName.toLowerCase()];
	if (named) return named;
	if (!isDescriptor(descriptor)) return UNKNOWN;
	const view = VIEWS[descriptor.kind] as (d: FieldDescriptor) => FieldTypeView;
	return view(descriptor);
}

const RUNTIME_KINDS = new Set(["string", "number", "boolean", "array", "object", "null", "undefined"]);

/**
 * Icon and label of a type sampled at run time by the browse `/columns`
 * route (string, number, boolean, object, array, null), so sampled and
 * declared columns share one vocabulary.
 */
export function describeRuntimeType(type: string, fieldName: string): FieldTypeView {
	if (type === "date") return describeField({ kind: "date" }, fieldName);
	if (type === "object") return describeField({ kind: "object", fields: {} }, fieldName);
	if (type === "array") return describeField({ kind: "array" }, fieldName);
	return describeField(
		RUNTIME_KINDS.has(type) ? ({ kind: type } as FieldDescriptor) : { kind: "unknown" },
		fieldName,
	);
}

const PRIMARY_KEY_NAMES = new Set(["id", "_id"]);
const PRIMARY_KEY_INDEXES = ["pk", "primary"] as const;

export function isPrimaryKey(
	fieldName: string,
	indexes: Record<string, { fields?: string[] }>,
): boolean {
	if (PRIMARY_KEY_NAMES.has(fieldName)) return true;
	return PRIMARY_KEY_INDEXES.some((name) => indexes[name]?.fields?.includes(fieldName));
}

/** What a column is for the structure: its colour role in every view. */
export type ColumnRole = "key" | "relation" | "plain";

/** The CSS colour class of each role: warning for keys, primary for relations. */
export const COLUMN_ROLE_CLASSES: Record<ColumnRole, string> = {
	key: "text-warning",
	relation: "text-primary",
	plain: "text-muted",
};

export interface ModifierView {
	icon: string;
	/** i18n key of the modifier's name. */
	labelKey?: string;
	/** The modifier id, shown when it has no name of its own. */
	id: string;
}

const MODIFIERS: Record<string, Omit<ModifierView, "id">> = {
	HashModifier: { icon: "i-ph-fingerprint", labelKey: "dms_database.modifiers.hashed" },
	LocalizationModifier: { icon: "i-ph-translate", labelKey: "dms_database.modifiers.localized" },
	EncryptionModifier: { icon: "i-ph-lock-key", labelKey: "dms_database.modifiers.encrypted" },
};

export function describeModifier(id: string): ModifierView {
	return { id, ...(MODIFIERS[id] ?? { icon: "i-ph-sliders" }) };
}
