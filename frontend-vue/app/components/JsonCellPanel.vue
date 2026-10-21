<script setup lang="ts">
import { jsonDraftText, parseJsonDraft } from '../build/data/cellValues'

// Edits a structured cell (an object or a list) as JSON in a DMS drawer;
// applying stages the value like any other cell. null empties the cell.
// Opened through `useDrawer`, it mounts anew for each cell. The panel fills
// the drawer's flex body, its DMS footer at the drawer's end; the editor
// grows with the JSON up to MAX_LINES, then scrolls.

const props = defineProps<{
	column: string
	value: unknown
	readOnly: boolean
}>()

// Applying settles the drawer with the value, cancelling with nothing (null
// is a value: it empties the cell).
const emit = defineEmits<{ success: [result?: { value: unknown }] }>()

const { t } = useI18n()

const MIN_LINES = 12
const MAX_LINES = 40

const draft = ref(jsonDraftText(props.value))

const parsed = computed(() => parseJsonDraft(draft.value))

const parseError = computed(() => {
	const result = parsed.value
	if (result.ok) return null
	if (result.reason === 'not_structured')
		return t('dms_database.data.json.not_structured')
	// Localized prefix + the engine's parse detail (position, token…).
	return result.detail
		? `${t('dms_database.data.json.invalid')} — ${result.detail}`
		: t('dms_database.data.json.invalid')
})

function save() {
	const result = parsed.value
	if (!result.ok || props.readOnly) return
	emit('success', { value: result.value })
}
</script>

<template>
	<div class="flex w-full min-w-0 flex-1 flex-col gap-4">
		<!-- A DMS form of one field, stacked for the drawer: the column as its
		label and the help above, the JSON in the DMS code input across the
		drawer, the parse error under it in DMS error style, the legend. -->
		<div class="grid gap-2">
			<DmsFieldRow
				layout="stack"
				:inset="false"
				spacing="list"
				:label="column"
				label-for="dms-database-json-cell"
				:description="t('dms_database.data.json.help')"
				required
			>
				<UFormField name="json" :error="(!readOnly && parseError) || false">
					<DmsInputCode
						id="dms-database-json-cell"
						v-model="draft"
						language="json"
						:min-lines="MIN_LINES"
						:max-lines="MAX_LINES"
						:disabled="readOnly"
					/>
					<template #error="{ error }">
						<DmsFormErrorText :error />
					</template>
				</UFormField>
			</DmsFieldRow>
			<DmsFormRequiredLegend v-if="!readOnly" />
		</div>

		<DmsContainerFooter>
			<UButton
				variant="outline"
				color="neutral"
				size="lg"
				:label="t('dms_database.common.cancel')"
				@click="emit('success')"
			/>
			<UButton
				v-if="!readOnly"
				size="lg"
				:label="t('dms_database.data.json.apply')"
				:disabled="Boolean(parseError)"
				@click="save"
			/>
		</DmsContainerFooter>
	</div>
</template>
