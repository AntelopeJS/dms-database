interface RelationDeclaration {
	fromField: string;
	toSchema: string;
	toTable: string;
	toField: string;
	many: boolean;
}

type FieldDescriptor =
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

interface TableSummary {
	name: string;
	fields: Record<string, FieldDescriptor>;
	indexes: Record<string, { fields?: string[]; multi?: boolean }>;
	relations: RelationDeclaration[];
	modifiers?: Record<string, string[]>;
}

type SchemaLabelColor =
	| "primary"
	| "secondary"
	| "success"
	| "info"
	| "warning"
	| "error"
	| "neutral";

interface SchemaLabel {
	text: string;
	color?: SchemaLabelColor;
}

interface SchemaStats {
	tableCount: number;
	elementCount: number;
	instanceCount: number;
}

interface SchemaSummary {
	id: string;
	options: Record<string, never>;
	tables: TableSummary[];
	label?: SchemaLabel;
	stats: SchemaStats;
	instances: string[];
}

const SCHEMAS_ENDPOINT = "/api/database/schemas";
const EMPTY_SCHEMAS = { schemas: [] as SchemaSummary[] };

export function useDatabaseSchemas() {
	const { useFetchAuth } = useAuthFetch();
	const { data, pending, error, refresh } = useFetchAuth<{
		schemas: SchemaSummary[];
	}>(SCHEMAS_ENDPOINT, { default: () => EMPTY_SCHEMAS });

	return {
		schemas: computed(() => data.value?.schemas ?? []),
		isLoading: pending,
		error,
		refresh,
	};
}

export type {
	FieldDescriptor,
	RelationDeclaration,
	SchemaSummary,
	TableSummary,
};
