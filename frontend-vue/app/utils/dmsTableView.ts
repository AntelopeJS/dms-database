// Helpers that build, by hand, the *serialised* column config the shared
// dms-ui `DmsTableView` component expects.
//
// The DMS normally generates these objects on the backend from a
// `DataController` (one fixed table per controller). The module's navigation
// lists (overview, schema inspector) render read-only tables against module
// endpoints without such a controller, so we reproduce the same serialised
// shapes the DMS emits for its own tables.
//
// Reference shapes:
//   DataTypeConfig  — dms-core/app/types/data-type.ts
//   TableViewColumn — dms-ui/.../table-view/types/column.ts
//   ComponentInfo   — { componentName, options? }

// The component name a serialised `FormComponents.InputText()` resolves to.
const TEXT_INPUT_COMPONENT = "dms-input-text";

export interface DmsComponentInfo {
	componentName: string;
	options?: Record<string, unknown>;
}

export interface DmsDataTypeConfig {
	id: string;
	compareModes: string[];
	defaultCompareMode?: string;
	filterComponents: Record<string, DmsComponentInfo | "noInput">;
	inputComponent: DmsComponentInfo;
}

export interface DmsTableViewColumn {
	id: string;
	header: string;
	accessorKey: string;
	listable: boolean;
	type: DmsDataTypeConfig;
	visible?: boolean;
	enableSorting?: boolean;
	enableColumnFilter?: boolean;
	readonlyBehavior?: string;
}

// A string/text data type — the safe default for an introspected, schemaless
// column. `id` is the load-bearing field: DmsTableView dereferences
// `column.type.id` during setup, so every column MUST carry a valid type config
// or the component throws immediately.
export function stringDataType(): DmsDataTypeConfig {
	return {
		id: "string",
		// Filter modes offered when column filtering is enabled; the browse backend
		// decodes `is` (exact) and `contains` (substring).
		compareModes: ["is", "contains"],
		defaultCompareMode: "contains",
		filterComponents: {
			default: { componentName: TEXT_INPUT_COMPONENT },
			is: { componentName: TEXT_INPUT_COMPONENT },
			contains: { componentName: TEXT_INPUT_COMPONENT },
		},
		inputComponent: { componentName: TEXT_INPUT_COMPONENT },
	};
}

export interface ReadonlyColumnSpec {
	key: string;
	header: string;
	enableSorting?: boolean;
}

// Build read-only, sortable columns with explicit (i18n) headers — used by the
// table-navigation lists, which are display-only (no form components).
export function buildReadonlyColumns(
	specs: ReadonlyColumnSpec[],
): DmsTableViewColumn[] {
	return specs.map((spec) => ({
		id: spec.key,
		accessorKey: spec.key,
		header: spec.header,
		listable: true,
		type: stringDataType(),
		enableSorting: spec.enableSorting ?? true,
		enableColumnFilter: false,
	}));
}
