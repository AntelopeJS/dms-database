<script setup lang="ts">
import { jsonDraftText, parseJsonDraft } from '../build/data/cellValues'

// Edits a structured cell (an object or a list) as JSON in a DMS drawer;
// applying stages the value like any other cell. null empties the cell.
// Opened through `useDrawer`, it mounts anew for each cell.

const props = defineProps<{
	column: string
	value: unknown
	readOnly: boolean
}>()

// Applying settles the drawer with the value, cancelling with nothing (null
// is a value: it empties the cell).
const emit = defineEmits<{ success: [result?: { value: unknown }] }>()

const { t } = useI18n()

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
	<div class="flex h-full w-full min-w-0 flex-col gap-4">
		<!-- A DMS form of one field: the column as its label, the JSON in the
		DMS code input, the parse error in DMS error style, the required legend. -->
		<div class="grid min-h-0 flex-1 content-start gap-2">
			<DmsFieldRow
				layout="form"
				:inset="false"
				spacing="row"
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
						:min-lines="12"
						:max-lines="30"
						:disabled="readOnly"
					/>
					<template #error="{ error }">
						<DmsFormErrorText :error />
					</template>
				</UFormField>
			</DmsFieldRow>
			<DmsFormRequiredLegend v-if="!readOnly" />
		</div>

		<footer
			class="border-default flex items-center justify-end gap-2 border-t pt-3"
		>
			<UButton
				variant="ghost"
				color="neutral"
				:label="t('dms_database.common.cancel')"
				@click="emit('success')"
			/>
			<UButton
				v-if="!readOnly"
				:label="t('dms_database.data.json.apply')"
				:disabled="Boolean(parseError)"
				@click="save"
			/>
		</footer>
	</div>
</template>
