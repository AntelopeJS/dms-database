<script setup lang="ts">
import type { TableSummary } from "../../composables/useDatabaseSchemas";
import SchemaTableInspector from "../../components/SchemaTableInspector.vue";
import { buildReadonlyColumns } from "../../utils/dmsTableView";

const TABLES_LOCATION = "/api/database/tables";
const COMPONENT_ID = "database-schemas-tables";
const PAGE_ID = "database.schemas";

// One table summary row, as returned by /api/database/tables/list.
interface TableListRow {
	id: string;
	schema: string;
	name: string;
	columnCount: number;
	indexCount: number;
	relationCount: number;
	elementCount: number;
}

const route = useDmsRoute();
const { t } = useI18n();
const { schemas } = useDatabaseSchemas();

const fullFormatter = new Intl.NumberFormat("en-US");

// --- schema selection (pill) ---
// Local state (not URL-bound) to avoid re-triggering the global module-routing
// guard on every selection, which can loop. Deep links via ?schema are honoured
// once on load; the diagram link carries the schema explicitly.
const initialSchema = route.query.schema;
const selectedSchemaId = ref<string | null>(
	typeof initialSchema === "string" && initialSchema.length > 0
		? initialSchema
		: null,
);

const currentSchema = computed(
	() => schemas.value.find((s) => s.id === selectedSchemaId.value) ?? null,
);

const schemaOptions = computed(() =>
	schemas.value.map((s) => ({ label: s.id, value: s.id })),
);

watch(
	schemas,
	(list) => {
		if (selectedSchemaId.value) return;
		if (list[0]) selectedSchemaId.value = list[0].id;
	},
	{ immediate: true },
);

// --- list / diagram view toggle (inline alternate view, no navigation) ---
// View is local state, diagram by default; ?view=list deep links are honoured
// once on load without writing back to the URL.
type SchemaView = "list" | "diagram";
const view = ref<SchemaView>(route.query.view === "list" ? "list" : "diagram");
const viewItems = computed(() => [
	{ label: t("dms_database.schemas.view.diagram"), value: "diagram" as const, icon: "i-ph-graph" },
	{ label: t("dms_database.schemas.view.list"), value: "list" as const, icon: "i-ph-table" },
]);

// --- tables list (shared DmsTableView, read-only) ---
const columns = computed(() =>
	buildReadonlyColumns([
		{ key: "name", header: t("dms_database.overview.tables.cols.table") },
		{ key: "elementCount", header: t("dms_database.overview.tables.cols.rows") },
		{ key: "columnCount", header: t("dms_database.overview.tables.cols.columns") },
		{ key: "indexCount", header: t("dms_database.overview.tables.cols.indexes") },
		{ key: "relationCount", header: t("dms_database.schemas.cols.relations") },
	]),
);

// Pin the table list to the selected schema. The table is remounted (`:key`) when
// the schema changes so the filter is rebuilt cleanly.
const defaultFilters = computed(() =>
	selectedSchemaId.value
		? [{ accessorKey: "schema", value: selectedSchemaId.value, mode: "is" }]
		: [],
);

const collectionsLabel = computed(() =>
	t(
		"dms_database.schemas.collections",
		{ count: currentSchema.value?.tables.length ?? 0 },
		currentSchema.value?.tables.length ?? 0,
	),
);

// --- inspector (shared dms drawer) ---
// Opened imperatively through the dms-ui `useDrawer` composable: the shared
// DynamicDrawer owns the themed surface, the header (table name + subtitle) and
// the close button; SchemaTableInspector only renders the body (tabs + content).
const { open: openDrawer } = useDrawer();

function inspectorSubtitle(table: TableSummary, rows: number | null): string {
	const parts: string[] = [];
	if (rows != null) {
		parts.push(
			`${fullFormatter.format(rows)} ${t("dms_database.overview.storage.rowsUnit")}`,
		);
	}
	parts.push(
		t("dms_database.data.colCount", {
			count: Object.keys(table.fields ?? {}).length,
		}),
	);
	return parts.join(" · ");
}

function openInspectorForTable(table: TableSummary, rows: number | null) {
	// `useDrawer` (dms-ui ≥ 0.1.3) defers the actual open until any closing
	// row-actions menu has left the DOM, so opening from the "View details"
	// dropdown no longer flashes the drawer in and out — no local wait needed.
	// The schema id is captured here (at call time) into componentOptions rather
	// than read lazily: the open may still be deferred while the menu closes, and
	// the schema pill could change in that window.
	openDrawer({
		title: table.name,
		description: inspectorSubtitle(table, rows),
		direction: "right",
		component: SchemaTableInspector,
		componentOptions: {
			schemaId: selectedSchemaId.value,
			table,
		},
	});
}

function openInspector(row: TableListRow) {
	// The list row carries display counts; the full descriptor (fields/indexes/
	// relations) comes from the schema introspection the inspector needs.
	const table = currentSchema.value?.tables.find((tbl) => tbl.name === row.name);
	if (!table) return;
	openInspectorForTable(table, row.elementCount ?? null);
}

// Double-clicking a table node in the diagram opens the same inspector drawer.
function openInspectorByName(tableName: string) {
	const table = currentSchema.value?.tables.find((tbl) => tbl.name === tableName);
	if (!table) return;
	openInspectorForTable(table, null);
}

// A row (double-)click opens the table inspector drawer.
useTableViewRowClick<TableListRow>(COMPONENT_ID, openInspector);
</script>

<template>
	<div class="space-y-5 pb-6">
		<section class="flex flex-wrap items-center gap-4 pt-6 pb-2">
			<div
				class="rounded-lg bg-primary/10 shadow-sm shrink-0 ring ring-primary/20 flex items-center justify-center size-12"
			>
				<UIcon name="i-ph-tree-structure" class="text-primary" size="1.75rem" />
			</div>
			<div class="flex-1 min-w-0">
				<h1 class="text-highlighted font-semibold">
					{{ $t("dms_database.schemas.title") }}
				</h1>
				<p class="text-muted text-sm">
					{{ $t("dms_database.schemas.description") }}
				</p>
			</div>
			<div class="flex items-center gap-3 ml-auto">
				<USelect
					v-model="selectedSchemaId"
					:items="schemaOptions"
					icon="i-ph-database"
					:placeholder="$t('dms_database.data.schema')"
					class="min-w-40"
				/>
				<DmsSegmented
					v-model="view"
					:items="viewItems"
					:aria-label="$t('dms_database.schemas.view.list')"
				/>
			</div>
		</section>

		<div v-show="view === 'list'" class="space-y-2">
			<p class="text-dimmed px-1 text-xs">
				<span class="font-mono">{{ selectedSchemaId }}</span>
				· {{ collectionsLabel }}
			</p>
			<DmsTableView
				v-if="selectedSchemaId"
				:key="selectedSchemaId"
				:location="TABLES_LOCATION"
				:columns="columns"
				:form-components="{}"
				:form-container="{ type: 'drawer' }"
				:row-actions="{ details: true }"
				:default-filters="defaultFilters"
				:default-sort="{ field: 'elementCount', desc: true }"
				:component-id="COMPONENT_ID"
				:page-id="PAGE_ID"
				row-id-key="id"
			/>
		</div>

		<!-- DmsClientOnly: vue-flow is not SSR-safe. Kept mounted (v-show) so toggling
		     List/Diagram preserves un-applied diagram edits and avoids a blocking
		     confirm dialog on every switch. -->
		<DmsClientOnly>
			<DmsDatabaseSchemaDiagram
				v-show="view === 'diagram'"
				:schema-id="selectedSchemaId"
				:active="view === 'diagram'"
				@inspect-table="openInspectorByName"
			/>
		</DmsClientOnly>
	</div>
</template>
