import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { expandForSearch, searchTables, tableNodeId } from '../diagram/graph'
import type { SchemaSummary } from './useDatabaseSchemas'

/** What the search reads and writes of the diagram page. */
interface SearchContext {
	schema: ComputedRef<SchemaSummary | null>
	schemaId: ComputedRef<string | null>
	focusIds: ComputedRef<Set<string> | null>
	focusId: Ref<string | null>
	expanded: ShallowRef<Set<string>>
	setExpanded: (next: Set<string>) => void
	render: () => void
	centerOn: (nodeId: string) => boolean
}

/** A table or a column; Enter goes from match to match (D-13). */
export function useDiagramSearch({
	schema,
	schemaId,
	focusIds,
	focusId,
	expanded,
	setExpanded,
	render,
	centerOn,
}: SearchContext) {
	const search = ref('')
	const searchIndex = ref(-1)

	const searchMatches = computed(() =>
		schema.value ? searchTables(schema.value, search.value) : [],
	)
	const searchMissed = computed(
		() => search.value.trim() !== '' && searchMatches.value.length === 0,
	)
	const searchPosition = computed(() =>
		searchIndex.value >= 0 && searchMatches.value.length > 1
			? `${searchIndex.value + 1}/${searchMatches.value.length}`
			: null,
	)

	// Synchronous: an Enter right after the text changed starts from the first
	// match of the new text.
	watch(
		search,
		() => {
			searchIndex.value = -1
		},
		{ flush: 'sync' },
	)

	function runSearch() {
		const matches = searchMatches.value
		if (!matches.length || !schemaId.value) return
		searchIndex.value = (searchIndex.value + 1) % matches.length
		const tableName = matches[searchIndex.value] ?? ''
		const id = tableNodeId(schemaId.value, tableName)
		if (focusIds.value && !focusIds.value.has(id)) focusId.value = null
		// A column found in a folded table unfolds it.
		if (schema.value) {
			const next = expandForSearch(
				schema.value,
				tableName,
				search.value,
				expanded.value,
			)
			if (next !== expanded.value) {
				setExpanded(next)
				render()
			}
		}
		nextTick(() => centerOn(id))
	}

	return { search, searchIndex, searchMissed, searchPosition, runSearch }
}
