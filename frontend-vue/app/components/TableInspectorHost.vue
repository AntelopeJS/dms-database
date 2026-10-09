<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import {
	findTableIn,
	useDatabaseSchemas,
} from '../build/composables/useDatabaseSchemas'
import { readFilterState, withFilterState } from '../build/schemas/filterState'
import {
	useSchemasListing,
	type SchemasListingRow,
} from '../build/schemas/useSchemasListing'
import TableInspector, { type InspectorTab } from './TableInspector.vue'

// Opens the Schemas page's table inspector from the right, as on the
// diagram. A DMS drawer target slides up from the bottom and takes no side,
// so the table view's Inspect action opens this page on
// `?schema=…&table=…` (where the inspector's relation links already lead)
// and this component, which shows nothing itself, opens the drawer on that
// table. J and K step through the tables as the table view lists them: the
// filter bar's filters, the table view's sort (S-5); closing the drawer
// drops the table from the URL.
//
// The page may mount this component anew on a navigation (Back, a link):
// the drawer belongs to the instance that opened it, which closes it when it
// goes, so a new instance never opens a second one over it.

interface AskedTable {
	schema: string
	table: string
}

const props = defineProps<{ pageId?: string; componentId?: string }>()

const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const toast = useToast()
const { open: openDrawer } = useDrawer()
// The tables as the table view lists them, shared with the filter bar.
const listing = useSchemasListing(props.pageId ?? '')
// Loaded once for every table the drawer steps through.
const {
	schemas,
	isSettled: schemasSettled,
	error: schemasError,
} = useDatabaseSchemas()

function queryValue(key: string): string | undefined {
	const value = route.query[key]
	return typeof value === 'string' && value !== '' ? value : undefined
}

const asked = computed<AskedTable | null>(() => {
	const schema = queryValue('schema')
	const table = queryValue('table')
	return schema && table ? { schema, table } : null
})

function keyOf(schema: string, table: string): string {
	return `${schema}::${table}`
}

let drawer: ReturnType<typeof openDrawer> | null = null
let openKey: string | null = null
let navigation: ReturnType<typeof rowNavigation> | undefined
// A link out of the inspector closes the drawer and names its own page.
let linkedOut = false
// Set once this instance is gone: nothing it scheduled may act after.
let disposed = false
// The tab the inspector shows, kept while J / K mount it on another table.
const tab = ref<InspectorTab>('columns')

// --- history: closing goes back when the opening added an entry ---
// The URL of a table opened over the bare list, one history entry back (a
// row clicked): closing goes back to that entry instead of adding one, so
// Back then leaves the list. Any other opening (a deep link, Back, a
// relation link) closes in place.
let overList: string | null = null
let lastAsked = asked.value
let popped = false
// J / K replace the URL: the entry before it stays the bare list.
let stepping = false

// On the window, once in the browser: the page also renders on the server.
useEventListener('popstate', () => {
	popped = true
})

watch(
	() => route.fullPath,
	(path, previous) => {
		const fromHistory = popped
		const fromBareList = lastAsked === null
		popped = false
		lastAsked = asked.value
		if (stepping) {
			stepping = false
			if (overList === previous) overList = path
			return
		}
		overList =
			!fromHistory && fromBareList && asked.value !== null ? path : null
	},
)

function rowNavigation(tables: SchemasListingRow[], index: number) {
	return {
		index,
		total: tables.length,
		hasPrev: index > 0,
		hasNext: index < tables.length - 1,
		prev: () => step(tables[index - 1]),
		next: () => step(tables[index + 1]),
	}
}

// A table the filters leave out of the list opens without J / K.
function inspectorOptions(schema: string, table: string) {
	const tables = listing.rows.value
	const index = tables.findIndex(
		(row) => row.schema === schema && row.name === table,
	)
	navigation = index < 0 ? undefined : rowNavigation(tables, index)
	// The list counts the rows of the instance the bar picked; the inspector
	// gives a table's rows in every instance.
	const countsAll = listing.state.value.instance.kind === 'all'
	return {
		componentKey: keyOf(schema, table),
		componentOptions: {
			rowData: {
				schema,
				name: table,
				elementCount: countsAll ? tables[index]?.elementCount : undefined,
			},
			navigation,
			schemas: schemasSettled.value ? schemas.value : undefined,
			initialTab: tab.value,
			onSuccess: () => {
				linkedOut = true
			},
			onTabChange: (value: InspectorTab) => {
				tab.value = value
			},
		},
	}
}

// The filter bar's keys are kept, the empty ones an Inspect URL writes
// dropped.
function withTable(schema?: string, table?: string) {
	const query = withFilterState(route.query, readFilterState(route.query))
	return { query: { ...query, schema, table } }
}

function settle(instance: NonNullable<typeof drawer>) {
	if (drawer !== instance) return
	const closedKey = openKey
	drawer = null
	openKey = null
	navigation = undefined
	tab.value = 'columns'
	if (disposed || linkedOut) return
	// Back, or a link, already took the URL off this table.
	const current = asked.value
	if (!current || keyOf(current.schema, current.table) !== closedKey) return
	if (overList === route.fullPath) {
		overList = null
		router.back()
	} else router.replace(withTable())
}

function inspect(schema: string, table: string) {
	const options = inspectorOptions(schema, table)
	openKey = options.componentKey
	if (drawer) {
		drawer.patch(options)
		return
	}
	linkedOut = false
	const instance = openDrawer({
		title: t('dms_database.schemas.inspector.title'),
		direction: 'right',
		component: TableInspector,
		...options,
	})
	drawer = instance
	const done = () => settle(instance)
	instance.result.then(done, done)
}

// The drawer shows the next table at once; the URL follows.
function step(row: SchemasListingRow | undefined) {
	if (disposed || !row) return
	inspect(row.schema, row.name)
	stepping = true
	router.replace(withTable(row.schema, row.name))
}

// Whether the table is registered; undefined until it can tell. The list
// answers first, unless the filter bar leaves the table out of it: the
// schemas, which hold every table, answer then. Schemas that failed to load
// cannot tell: the inspector opens as before.
function isKnown(target: AskedTable): boolean | undefined {
	const listed = listing.rows.value.some(
		(row) => row.schema === target.schema && row.name === target.table,
	)
	if (listed) return true
	if (!schemasSettled.value) return undefined
	if (schemasError.value) return true
	return findTableIn(schemas.value, target.schema, target.table) !== undefined
}

// A table that does not exist (renamed, dropped, a stale link) opens
// nothing: the URL drops it and a toast says so.
function dismissUnknown(target: AskedTable) {
	drawer?.close()
	router.replace(withTable())
	toast.add({
		title: t('dms_database.schemas.inspector.not_found'),
		description: `${target.schema}.${target.table}`,
		icon: 'i-ph-magnifying-glass',
		color: 'neutral',
	})
}

function sync() {
	if (disposed) return
	const target = asked.value
	if (!target) {
		drawer?.close()
		return
	}
	const known = isKnown(target)
	if (known === undefined) return
	if (known) inspect(target.schema, target.table)
	else dismissUnknown(target)
}

// The schemas arriving fill the open inspector in; the list arriving, or
// filtered or sorted anew, moves J / K.
watch([schemas, schemasSettled, listing.rows], () => {
	if (drawer && openKey) {
		const [schema = '', table = ''] = openKey.split('::')
		drawer.patch(inspectorOptions(schema, table))
	}
})

onMounted(() => {
	watch([asked, listing.status, schemasSettled], sync, { immediate: true })
})

onBeforeUnmount(() => {
	disposed = true
	const open = drawer
	drawer = null
	openKey = null
	navigation = undefined
	open?.close()
})

useEventListener('keydown', (event: KeyboardEvent) => {
	if (!navigation || event.metaKey || event.ctrlKey || event.altKey) return
	const target = event.target as HTMLElement | null
	if (target?.closest('input, textarea, select, [contenteditable=true]')) return
	const key = event.key.toLowerCase()
	if (key === 'j' && navigation.hasNext) navigation.next()
	else if (key === 'k' && navigation.hasPrev) navigation.prev()
	else return
	event.preventDefault()
})
</script>

<template>
	<span data-dms-database-inspector-host hidden />
</template>

<style>
/* The page spaces its blocks: this one takes no room. */
.dms-page-stack > :has(> [data-dms-database-inspector-host]) {
	display: none;
}

/* A long table name ends with an ellipsis. The DMS mono cell is an
   inline-flex box as wide as its text, so its cell clips it short of its
   own ellipsis: held to the cell's width, it shrinks and ellipsizes. Only on
   this page, the one holding the inspector host. */
.dms-page-stack:has([data-dms-database-inspector-host]) td .group\/mono {
	display: flex;
	max-width: 100%;
}
</style>
