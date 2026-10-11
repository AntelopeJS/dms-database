<script setup lang="ts">
const props = defineProps<{
	open: boolean
	column: string
	value: unknown
	readOnly: boolean
}>()

const emit = defineEmits<{
	'update:open': [open: boolean]
	save: [value: unknown]
}>()

// Edits a structured cell (an object or a list) as JSON; applying stages the
// value like any other cell. null empties the cell.
const { t } = useI18n()

const draft = ref('')

watch(
	() => props.open,
	(open) => {
		if (!open) return
		try {
			draft.value = JSON.stringify(props.value, null, 2) ?? ''
		} catch {
			draft.value = ''
		}
	},
	{ immediate: true },
)

const parseError = computed(() => {
	try {
		const parsed = JSON.parse(draft.value)
		if (parsed !== null && typeof parsed !== 'object') {
			return t('dms_database.data.json.not_structured')
		}
		return null
	} catch (error) {
		// Localized prefix + the engine's parse detail (position, token…).
		return error instanceof Error
			? `${t('dms_database.data.json.invalid')} — ${error.message}`
			: t('dms_database.data.json.invalid')
	}
})

function save() {
	if (parseError.value || props.readOnly) return
	emit('save', JSON.parse(draft.value))
}
</script>

<template>
	<USlideover
		:open="open"
		:title="t('dms_database.data.json.title', { column })"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<!-- A DMS form of one field: the column as its label, the JSON in the
			DMS code input, the parse error in DMS error style, the required legend. -->
			<div class="grid gap-2">
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
				<DmsFormRequiredLegend v-if="!readOnly" class="pb-2" />
			</div>
		</template>
		<template #footer>
			<div class="flex w-full justify-end gap-2">
				<UButton
					variant="ghost"
					color="neutral"
					:label="t('dms_database.common.cancel')"
					@click="emit('update:open', false)"
				/>
				<UButton
					v-if="!readOnly"
					:label="t('dms_database.data.json.apply')"
					:disabled="Boolean(parseError)"
					@click="save"
				/>
			</div>
		</template>
	</USlideover>
</template>
