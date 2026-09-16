<script setup lang="ts">
const props = defineProps<{
	value: unknown;
	editable: boolean;
	editing: boolean;
	pending: boolean;
	invalid: boolean;
	focused: boolean;
}>();

const emit = defineEmits<{
	select: [];
	"start-edit": [];
	commit: [draft: string | boolean, source: "enter" | "blur"];
	cancel: [];
	"open-json": [];
}>();

const isJson = computed(
	() => props.value !== null && props.value !== undefined && typeof props.value === "object",
);
const isNull = computed(() => props.value === null || props.value === undefined);

const display = computed(() => {
	if (isNull.value) return "";
	if (isJson.value) {
		try {
			return JSON.stringify(props.value);
		} catch {
			return String(props.value);
		}
	}
	return String(props.value);
});

// --- inline editing ---
const draft = ref("");
const boolDraft = ref(false);
const cellInput = useTemplateRef<HTMLInputElement | HTMLSelectElement>("cellInput");
// Set before blurring on Escape so the blur-commit does not fire after a cancel.
const cancelling = ref(false);

watch(
	() => props.editing,
	(editing) => {
		if (!editing) return;
		cancelling.value = false;
		if (typeof props.value === "boolean") {
			boolDraft.value = props.value;
		} else {
			draft.value = isNull.value ? "" : String(props.value);
		}
		nextTick(() => {
			cellInput.value?.focus();
			if (cellInput.value instanceof HTMLInputElement) cellInput.value.select();
		});
	},
);

// The parent needs the trigger: Enter keeps an invalid draft open for fixing,
// while a blur (click-away) discards it so the grid never holds an unfocused
// editor hostage.
function commit(source: "enter" | "blur") {
	if (cancelling.value) return;
	emit(
		"commit",
		typeof props.value === "boolean" ? boolDraft.value : draft.value,
		source,
	);
}

function cancel() {
	cancelling.value = true;
	emit("cancel");
}

function onDoubleClick() {
	if (isJson.value) emit("open-json");
	else if (props.editable) emit("start-edit");
}
</script>

<template>
	<td
		class="relative cursor-default border-r border-b border-default p-0 align-middle"
		:class="[
			invalid
				? 'ring-2 ring-error ring-inset'
				: focused
					? 'ring-2 ring-primary ring-inset'
					: '',
			editing ? 'bg-primary/5' : '',
		]"
		@click="emit('select')"
		@dblclick="onDoubleClick"
	>
		<template v-if="editing">
			<select
				v-if="typeof value === 'boolean'"
				ref="cellInput"
				v-model="boolDraft"
				class="w-full bg-default px-2 py-1 font-mono text-[12.5px] outline-none"
				@change="commit('enter')"
				@keydown.esc.stop="cancel"
				@keydown.stop
				@blur="commit('blur')"
			>
				<option :value="true">true</option>
				<option :value="false">false</option>
			</select>
			<input
				v-else
				ref="cellInput"
				v-model="draft"
				type="text"
				class="w-full bg-default px-2 py-1 font-mono text-[12.5px] outline-none"
				@keydown.enter.prevent="commit('enter')"
				@keydown.esc.stop="cancel"
				@keydown.stop
				@blur="commit('blur')"
			>
		</template>
		<div
			v-else
			class="flex items-center gap-1 overflow-hidden px-2.5 py-1 whitespace-nowrap"
		>
			<span
				v-if="isNull"
				class="rounded bg-elevated px-1 font-mono text-[10px] tracking-wide text-dimmed uppercase"
			>
				null
			</span>
			<span
				v-else
				class="overflow-hidden font-mono text-[12.5px] text-ellipsis"
				:class="isJson ? 'cursor-pointer text-info' : 'text-toned'"
			>
				{{ display }}
			</span>
			<UIcon
				v-if="pending"
				name="i-ph-circle-notch"
				class="size-3 shrink-0 animate-spin text-primary"
			/>
		</div>
	</td>
</template>
