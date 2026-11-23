import type { FieldDescriptor } from '../composables/useDatabaseSchemas'
import { isBoolean, isNumber, isRecord, isText } from './values'

/**
 * How a column's type reads in the inspector, the diagram and the grid: an
 * icon and a mono label. Colour never encodes the type: it is kept for
 * structure, primary keys and relations, which `columnRole` names.
 */
interface FieldTypeView {
	icon: string
	label: string
}

const UNKNOWN: FieldTypeView = { icon: 'i-ph-question', label: 'unknown' }
const STRING_ICON = 'i-ph-text-aa'
const NUMBER_ICON = 'i-ph-hash'
const BOOLEAN_ICON = 'i-ph-toggle-right'
const LIST_ICON = 'i-ph-brackets-square'
const OBJECT_ICON = 'i-ph-brackets-curly'
const ENUM_ICON = 'i-ph-list-checks'
const UNION_ICON = 'i-ph-arrows-split'

const NAMED_FIELDS = new Map<string, FieldTypeView>([
	['email', { icon: 'i-ph-at', label: 'email' }],
	['password', { icon: 'i-ph-lock', label: 'password' }],
	['secret', { icon: 'i-ph-lock', label: 'secret' }],
])

function literalIcon(value: string | number | boolean): string {
	if (isNumber(value)) return NUMBER_ICON
	if (isBoolean(value)) return BOOLEAN_ICON
	return STRING_ICON
}

function literalLabel(value: string | number | boolean): string {
	return isText(value) ? `"${value}"` : String(value)
}

function label(descriptor: FieldDescriptor): string {
	return describeField(descriptor).label
}

const SIMPLE_VIEWS = new Map<string, FieldTypeView>([
	['string', { icon: STRING_ICON, label: 'string' }],
	['number', { icon: NUMBER_ICON, label: 'number' }],
	['boolean', { icon: BOOLEAN_ICON, label: 'boolean' }],
	['date', { icon: 'i-ph-calendar-blank', label: 'date' }],
	['any', { icon: 'i-ph-asterisk', label: 'any' }],
	['unknown', UNKNOWN],
	['null', { icon: 'i-ph-circle-dashed', label: 'null' }],
	['undefined', { icon: 'i-ph-circle-dashed', label: 'undefined' }],
])

function viewOf(descriptor: FieldDescriptor): FieldTypeView {
	switch (descriptor.kind) {
		case 'literal':
			return {
				icon: literalIcon(descriptor.value),
				label: literalLabel(descriptor.value),
			}
		case 'array':
			return {
				icon: LIST_ICON,
				label: `${descriptor.element ? label(descriptor.element) : 'any'}[]`,
			}
		case 'tuple':
			return {
				icon: LIST_ICON,
				label: `[${descriptor.elements.map(label).join(', ')}]`,
			}
		case 'object':
			return {
				icon: OBJECT_ICON,
				label: descriptor.partial ? 'partial object' : 'object',
			}
		case 'record':
			return {
				icon: OBJECT_ICON,
				label: `Record<${descriptor.key ? label(descriptor.key) : 'string'}, ${label(descriptor.value)}>`,
			}
		case 'union':
			return {
				icon:
					descriptor.members.length > 0 &&
					descriptor.members.every((member) => member.kind === 'literal')
						? ENUM_ICON
						: UNION_ICON,
				label: descriptor.members.map(label).join(' | '),
			}
		case 'intersection':
			return {
				icon: UNION_ICON,
				label: descriptor.members.map(label).join(' & '),
			}
		case 'keyof':
			return {
				icon: ENUM_ICON,
				label:
					descriptor.keys.length > 0
						? descriptor.keys.map((key) => `"${key}"`).join(' | ')
						: 'keyof',
			}
		case 'refinement':
			return {
				icon: describeField(descriptor.base).icon,
				label: descriptor.name,
			}
		case 'recursive':
			return { icon: UNKNOWN.icon, label: descriptor.name }
		default:
			return SIMPLE_VIEWS.get(descriptor.kind) ?? UNKNOWN
	}
}

type DescriptorOf<K extends FieldDescriptor['kind']> = Extract<
	FieldDescriptor,
	{ kind: K }
>

function isDescriptorList(value: unknown): value is FieldDescriptor[] {
	return Array.isArray(value) && value.every(isFieldDescriptor)
}

function isOptionalDescriptor(
	value: unknown,
): value is FieldDescriptor | undefined {
	return value === undefined || isFieldDescriptor(value)
}

function isSimpleDescriptor(
	value: unknown,
): value is DescriptorOf<
	| 'string'
	| 'number'
	| 'boolean'
	| 'date'
	| 'unknown'
	| 'any'
	| 'null'
	| 'undefined'
> {
	return isRecord(value) && isText(value.kind) && SIMPLE_VIEWS.has(value.kind)
}

function isLiteralDescriptor(value: unknown): value is DescriptorOf<'literal'> {
	return (
		isRecord(value) &&
		value.kind === 'literal' &&
		(isText(value.value) || isNumber(value.value) || isBoolean(value.value))
	)
}

function isMembersDescriptor(
	value: unknown,
): value is DescriptorOf<'union' | 'intersection'> {
	return (
		isRecord(value) &&
		(value.kind === 'union' || value.kind === 'intersection') &&
		isDescriptorList(value.members)
	)
}

function isTupleDescriptor(value: unknown): value is DescriptorOf<'tuple'> {
	return (
		isRecord(value) &&
		value.kind === 'tuple' &&
		isDescriptorList(value.elements)
	)
}

function isArrayDescriptor(value: unknown): value is DescriptorOf<'array'> {
	return (
		isRecord(value) &&
		value.kind === 'array' &&
		isOptionalDescriptor(value.element)
	)
}

function isObjectDescriptor(value: unknown): value is DescriptorOf<'object'> {
	return (
		isRecord(value) &&
		value.kind === 'object' &&
		isRecord(value.fields) &&
		Object.values(value.fields).every(isFieldDescriptor) &&
		(value.partial === undefined || isBoolean(value.partial))
	)
}

function isRecordDescriptor(value: unknown): value is DescriptorOf<'record'> {
	return (
		isRecord(value) &&
		value.kind === 'record' &&
		isOptionalDescriptor(value.key) &&
		isFieldDescriptor(value.value)
	)
}

function isKeyofDescriptor(value: unknown): value is DescriptorOf<'keyof'> {
	return (
		isRecord(value) &&
		value.kind === 'keyof' &&
		Array.isArray(value.keys) &&
		value.keys.every(isText)
	)
}

function isNamedDescriptor(
	value: unknown,
): value is DescriptorOf<'refinement' | 'recursive'> {
	return (
		isRecord(value) &&
		isText(value.name) &&
		(value.kind === 'recursive' ||
			(value.kind === 'refinement' && isFieldDescriptor(value.base)))
	)
}

function isFieldDescriptor(value: unknown): value is FieldDescriptor {
	return (
		isSimpleDescriptor(value) ||
		isLiteralDescriptor(value) ||
		isMembersDescriptor(value) ||
		isTupleDescriptor(value) ||
		isArrayDescriptor(value) ||
		isObjectDescriptor(value) ||
		isRecordDescriptor(value) ||
		isKeyofDescriptor(value) ||
		isNamedDescriptor(value)
	)
}

/** Icon and label of a schema-declared type. */
export function describeField(
	descriptor: unknown,
	fieldName = '',
): FieldTypeView {
	const named = NAMED_FIELDS.get(fieldName.toLowerCase())
	if (named) return named
	return isFieldDescriptor(descriptor) ? viewOf(descriptor) : UNKNOWN
}

const NULL_KINDS = new Set<FieldDescriptor['kind']>(['null', 'undefined'])

/**
 * The type a column holds when it holds a value: a union's `null` and
 * `undefined` members off (`string | null` reads `string`), for a view that
 * says apart whether the column takes null.
 */
export function valueDescriptor(descriptor: FieldDescriptor): FieldDescriptor {
	if (descriptor.kind !== 'union') return descriptor
	const members = descriptor.members.filter((m) => !NULL_KINDS.has(m.kind))
	const [only] = members
	if (members.length === 0 || members.length === descriptor.members.length)
		return descriptor
	return members.length === 1 && only ? only : { ...descriptor, members }
}

const RUNTIME_DESCRIPTORS = new Map<string, FieldDescriptor>([
	['string', { kind: 'string' }],
	['number', { kind: 'number' }],
	['boolean', { kind: 'boolean' }],
	['null', { kind: 'null' }],
	['undefined', { kind: 'undefined' }],
	['date', { kind: 'date' }],
	['object', { kind: 'object', fields: {} }],
	['array', { kind: 'array' }],
])

/**
 * Icon and label of a type sampled at run time by the browse `/columns`
 * route (string, number, boolean, object, array, null), so sampled and
 * declared columns share one vocabulary.
 */
export function describeRuntimeType(
	type: string,
	fieldName: string,
): FieldTypeView {
	return describeField(
		RUNTIME_DESCRIPTORS.get(type) ?? { kind: 'unknown' },
		fieldName,
	)
}

const PRIMARY_KEY_NAMES = new Set(['id', '_id'])
const PRIMARY_KEY_INDEXES = ['pk', 'primary'] as const

export function isPrimaryKey(
	fieldName: string,
	indexes: Record<string, { fields?: string[] }>,
): boolean {
	if (PRIMARY_KEY_NAMES.has(fieldName)) return true
	return PRIMARY_KEY_INDEXES.some((name) =>
		indexes[name]?.fields?.includes(fieldName),
	)
}

/** What a column is for the structure: its colour role in every view. */
export type ColumnRole = 'key' | 'relation' | 'plain'

/** The CSS colour class of each role: warning for keys, primary for relations. */
export const COLUMN_ROLE_CLASSES: Record<ColumnRole, string> = {
	key: 'text-warning',
	relation: 'text-primary',
	plain: 'text-muted',
}

interface ModifierView {
	icon: string
	/** i18n key of the modifier's name. */
	labelKey?: string
	/** The modifier id, shown when it has no name of its own. */
	id: string
}

const MODIFIERS = new Map<string, Omit<ModifierView, 'id'>>([
	[
		'HashModifier',
		{ icon: 'i-ph-fingerprint', labelKey: 'dms_database.modifiers.hashed' },
	],
	[
		'LocalizationModifier',
		{ icon: 'i-ph-translate', labelKey: 'dms_database.modifiers.localized' },
	],
	[
		'EncryptionModifier',
		{ icon: 'i-ph-lock-key', labelKey: 'dms_database.modifiers.encrypted' },
	],
])

export function describeModifier(id: string): ModifierView {
	return { id, ...(MODIFIERS.get(id) ?? { icon: 'i-ph-sliders' }) }
}

/** The modifiers a table declares on one of its columns, by own key only. */
export function columnModifiers(
	modifiers: Record<string, string[]> | undefined,
	column: string,
): ModifierView[] {
	if (!modifiers || !Object.hasOwn(modifiers, column)) return []
	return (modifiers[column] ?? []).map(describeModifier)
}
