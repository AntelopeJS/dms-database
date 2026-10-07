<script setup lang="ts">
const props = defineProps<{
	open: boolean;
	column: string;
	value: unknown;
	readOnly: boolean;
}>();

const emit = defineEmits<{
	"update:open": [open: boolean];
	save: [value: unknown];
}>();

// Edits a structured cell (an object or a list) as JSON; applying stages the
// value like any other cell.
const { t } = useI18n();

const draft = ref("");

watch(
	() => props.open,
	(open) => {
		if (!open) return;
		try {
			draft.value = JSON.stringify(props.value, null, 2) ?? "";
		} catch {
			draft.value = "";
		}
	},
	{ immediate: true },
);

const parseError = computed(() => {
	try {
		const parsed = JSON.parse(draft.value);
		if (parsed === null || typeof parsed !== "object") {
			return t("dms_database.data.json.not_structured");
		}
		return null;
	} catch (error) {
		// Localized prefix + the engine's parse detail (position, token…).
		return error instanceof Error
			? `${t("dms_database.data.json.invalid")} — ${error.message}`
			: t("dms_database.data.json.invalid");
	}
});

function save() {
	if (parseError.value || props.readOnly) return;
	emit("save", JSON.parse(draft.value));
}
</script>

<template>
	<USlideover
		:open="open"
		:title="t('dms_database.data.json.title', { column })"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<div class="flex h-full flex-col gap-3">
				<textarea
					v-model="draft"
					:readonly="readOnly"
					class="min-h-96 flex-1 resize-none rounded-md border border-default bg-default p-3 font-mono text-xs outline-none focus:border-primary"
					spellcheck="false"
				/>
				<UAlert
					v-if="!readOnly && parseError"
					color="error"
					icon="i-ph-warning"
					:description="parseError"
				/>
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
