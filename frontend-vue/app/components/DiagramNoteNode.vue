<script setup lang="ts">
import type { NoteNodeData } from "../build/diagram/graph";

// A sticky note on the diagram: double-click to write, saved with the layout.
const props = defineProps<{ data: NoteNodeData; selected?: boolean }>();

const editing = ref(false);
const textBuffer = ref(props.data.text);

watch(
	() => props.data.text,
	(value) => {
		if (!editing.value) textBuffer.value = value;
	},
);

function commitText() {
	editing.value = false;
	if (textBuffer.value !== props.data.text) {
		props.data.onTextChange(props.data.noteId, textBuffer.value);
	}
}
</script>

<template>
	<div
		class="bg-warning/10 border-warning/40 text-toned relative flex flex-col overflow-hidden rounded-sm border shadow-sm backdrop-blur-sm"
		:class="{ 'ring-warning ring-2': selected }"
		:style="{ width: `${data.width}px`, height: `${data.height}px` }"
		@dblclick="editing = true"
	>
		<div class="text-warning flex h-7 shrink-0 cursor-grab items-center gap-1.5 px-3">
			<UIcon name="i-ph-note-pencil" class="size-3.5" />
			<span class="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase">
				{{ $t("dms_database.diagram.notes.label") }}
			</span>
			<button
				v-if="selected"
				type="button"
				class="hover:bg-warning/20 ml-auto rounded p-0.5"
				:aria-label="$t('dms_database.diagram.notes.delete')"
				:title="$t('dms_database.diagram.notes.delete')"
				@click.stop="data.onDelete(data.noteId)"
			>
				<UIcon name="i-ph-trash" class="size-3.5" />
			</button>
		</div>
		<textarea
			v-if="editing"
			v-model="textBuffer"
			class="nodrag w-full flex-1 resize-none bg-transparent px-3 pb-3 text-[12.5px] leading-normal outline-none"
			:placeholder="$t('dms_database.diagram.notes.placeholder')"
			autofocus
			@blur="commitText"
			@keydown.escape.prevent="commitText"
		/>
		<div
			v-else
			class="w-full flex-1 cursor-text overflow-auto px-3 pb-3 text-[12.5px] leading-normal break-words whitespace-pre-wrap"
			:class="data.text ? '' : 'text-dimmed'"
		>
			{{ data.text || $t("dms_database.diagram.notes.placeholder") }}
		</div>
	</div>
</template>
