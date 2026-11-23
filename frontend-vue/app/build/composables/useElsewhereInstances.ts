import type { Ref } from 'vue'
import type { InstanceRows } from '../../components/QueryResultPanel.vue'
import type { QueryTarget } from '../query/target'
import type { SchemaSummary } from './useDatabaseSchemas'
import type { ExecuteResult } from './useQueryStore'

const BROWSE_COUNT = '/api/database/browse/count'

/**
 * The named instances holding rows of the table a read found empty in the
 * default instance (decision 11): counted after the run, in the browser.
 */
export function useElsewhereInstances(schemas: Ref<SchemaSummary[]>) {
	const elsewhere = ref<InstanceRows[]>([])

	type CountRows = (query: Record<string, string>) => Promise<{ total: number }>

	async function instancesWithRows(
		target: QueryTarget,
		count: CountRows,
	): Promise<InstanceRows[]> {
		const instances =
			schemas.value.find((schema) => schema.id === target.schema)?.instances ??
			[]
		const counts = await Promise.all(
			instances.map((id) =>
				count({
					filter_schema: `is:${target.schema}`,
					filter_table: `is:${target.table}`,
					filter_instance: `is:${id}`,
				}).then(
					(res) => ({ id, count: res.total }),
					() => ({ id, count: 0 }),
				),
			),
		)
		return counts.filter((entry) => entry.count > 0)
	}

	const emptyTarget = shallowRef<QueryTarget | null>(null)
	const elsewhereRead = useApiData<InstanceRows[]>(
		() =>
			emptyTarget.value
				? `dms-database:elsewhere:${JSON.stringify([
						emptyTarget.value.schema,
						emptyTarget.value.table,
					])}`
				: null,
		async ({ $authFetch, signal }) => {
			const target = emptyTarget.value
			if (!target) return []
			return instancesWithRows(target, (query) =>
				$authFetch<{ total: number }>(BROWSE_COUNT, { query, signal }),
			)
		},
		{
			immediate: false,
			server: false,
			watch: false,
			refreshOnPageRefresh: false,
		},
	)

	let runId = 0

	async function findElsewhere(
		answer: Pick<ExecuteResult, 'mutation' | 'rows'>,
		next: QueryTarget,
	) {
		const id = ++runId
		elsewhere.value = []
		if (
			answer.mutation ||
			answer.rows.length > 0 ||
			next.instance !== '' ||
			!next.schema ||
			!next.table
		)
			return
		emptyTarget.value = next
		await elsewhereRead.execute()
		if (id === runId) elsewhere.value = elsewhereRead.data.value ?? []
	}

	return { elsewhere, findElsewhere }
}
