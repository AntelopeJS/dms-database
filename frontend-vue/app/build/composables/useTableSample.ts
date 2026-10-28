import type { ComputedRef, Ref } from 'vue'
import type { SchemaSummary } from './useDatabaseSchemas'

const BROWSE_LIST = '/api/database/browse/list'

interface SamplePage {
	results: Record<string, unknown>[]
	total: number
}

/**
 * The row asked for: its offset in an instance. No instance at offset 0 reads
 * the default one, or the first named instance holding rows when the default
 * one holds none.
 */
interface SampleRequest {
	instance: string | null
	offset: number
}

/** A sample read, with the table and the instance it was read from. */
interface SampleRead {
	table: string
	instance: string | null
	page: SamplePage
}

/** What the sample reads from: the inspected table, and where it is shown. */
interface SampleSource {
	schemaId: ComputedRef<string>
	tableName: ComputedRef<string>
	tableKey: ComputedRef<string>
	schema: ComputedRef<SchemaSummary | undefined>
	tab: Ref<string>
	loading: ComputedRef<boolean>
}

/**
 * The inspector's Sample tab: the latest row of the table, or the next one on
 * demand.
 */
export function useTableSample({
	schemaId,
	tableName,
	tableKey,
	schema,
	tab,
	loading,
}: SampleSource) {
	const { t } = useI18n()

	const requested = shallowRef<SampleRequest>({ instance: null, offset: 0 })

	type ReadSample = (instance: string | null) => Promise<SamplePage>

	async function firstFilledInstance(
		read: ReadSample,
	): Promise<{ instance: string | null; page: SamplePage }> {
		const page = await read(null)
		if (page.total > 0) return { instance: null, page }
		for (const instance of schema.value?.instances ?? []) {
			const named = await read(instance)
			if (named.total > 0) return { instance, page: named }
		}
		return { instance: null, page }
	}

	// Read once the Sample tab shows, in the browser only.
	const sampleRead = useApiData<SampleRead>(
		() =>
			schemaId.value && tableName.value
				? `dms-database:sample:${JSON.stringify([
						tableKey.value,
						requested.value.instance,
						requested.value.offset,
					])}`
				: null,
		async ({ $authFetch, signal }) => {
			const table = tableKey.value
			const { instance, offset } = requested.value
			const read: ReadSample = (from) =>
				$authFetch<SamplePage>(BROWSE_LIST, {
					query: {
						filter_schema: `is:${schemaId.value}`,
						filter_table: `is:${tableName.value}`,
						offset,
						limit: 1,
						...(from ? { filter_instance: `is:${from}` } : {}),
					},
					signal,
				})
			const found =
				instance === null && offset === 0
					? await firstFilledInstance(read)
					: { instance, page: await read(instance) }
			return { table, ...found }
		},
		{
			immediate: false,
			server: false,
			watch: false,
			refreshOnPageRefresh: false,
		},
	)

	// Another table (a relation followed) shows none of the previous one's row.
	const sampleShown = computed(() => {
		const value = sampleRead.data.value
		return value?.table === tableKey.value ? value : null
	})
	const sample = computed(() => sampleShown.value?.page.results?.[0] ?? null)
	const sampleTotal = computed(() => sampleShown.value?.page.total ?? 0)
	const sampleOffset = computed(() => requested.value.offset)
	const sampleLoading = computed(() => sampleRead.pending.value)
	const sampleFailed = computed(() => sampleRead.status.value === 'error')
	// The instance the sample is read from.
	const sampleInstance = computed(() => sampleShown.value?.instance ?? null)

	const sampleInstanceLabel = computed(() =>
		sampleInstance.value === null
			? t('dms_database.inspector.sample.default_instance')
			: t('dms_database.inspector.sample.named_instance', {
					name: sampleInstance.value,
				}),
	)

	function loadSample() {
		if (schemaId.value && tableName.value) void sampleRead.execute()
	}

	function nextSample() {
		const total = sampleTotal.value
		requested.value = {
			instance: sampleInstance.value,
			offset: total > 0 ? (requested.value.offset + 1) % total : 0,
		}
		loadSample()
	}

	// Another table (a relation followed) starts over from its latest row.
	watch(tableKey, () => {
		requested.value = { instance: null, offset: 0 }
		if (tab.value === 'sample' && !loading.value) loadSample()
	})

	// The sample waits for the schemas: they name the instances to look in.
	onMounted(() =>
		watch(
			() => tab.value === 'sample' && !loading.value,
			(ready) => {
				if (ready && !sample.value && !sampleLoading.value) loadSample()
			},
			{ immediate: true },
		),
	)

	// The `_instance` tag the store adds to rows of named instances is not a
	// column of the table.
	const sampleJson = computed(() => {
		if (!sample.value) return ''
		const { _instance: _tag, ...row } = sample.value
		return JSON.stringify(row, null, 2)
	})

	return {
		sample,
		sampleTotal,
		sampleOffset,
		sampleLoading,
		sampleFailed,
		sampleInstanceLabel,
		sampleJson,
		loadSample,
		nextSample,
	}
}
