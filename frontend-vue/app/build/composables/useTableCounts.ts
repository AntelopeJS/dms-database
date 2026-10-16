import type { Ref } from 'vue'
import { isFilterToken } from './useDataBrowserGrid'
import { DEFAULT_INSTANCE_VALUE } from './useDataBrowserTabs'

const TABLES_ENDPOINT = '/api/database/browse/tables'

interface TableEntry {
	name: string
	elementCount: number
}

/**
 * The rows of each table of a schema in one instance, for the data browser's
 * table list. A server render reads them and hands them over with the page;
 * another schema or instance is read once picked. No count shows while they
 * load, nor once they failed: `failed` says so.
 */
export function useTableCounts(
	schema: Ref<string | null>,
	instance: Ref<string>,
) {
	const { data, status } = useApiData<{ items: TableEntry[] }>(
		() => (schema.value ? TABLES_ENDPOINT : null),
		{
			query: () => {
				const query: Record<string, string> = {
					filter_schema: isFilterToken(schema.value ?? ''),
				}
				if (instance.value !== DEFAULT_INSTANCE_VALUE)
					query.filter_instance = isFilterToken(instance.value)
				return query
			},
		},
	)

	return {
		/** Rows by table name. */
		counts: computed<Record<string, number>>(() =>
			status.value === 'success'
				? Object.fromEntries(
						(data.value?.items ?? []).map((item) => [
							item.name,
							item.elementCount,
						]),
					)
				: {},
		),
		failed: computed(() => status.value === 'error'),
	}
}
