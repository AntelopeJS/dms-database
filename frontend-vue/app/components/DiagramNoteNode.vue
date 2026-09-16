<script setup lang="ts">
interface NoteNodeData {
	noteId: string;
	text: string;
	color: string | null;
	width: number;
	height: number;
	onTextChange: (noteId: string, text: string) => void;
	onDelete: (noteId: string) => void;
}

const props = defineProps<{ data: NoteNodeData; selected: boolean }>();

// Sticky-note palette (amber). Centralised so the note frame, header and ink
// stay in sync instead of being repeated as literals across the template.
const NOTE_DEFAULT_BG = "#fef9c3";
const NOTE_BORDER = "rgba(202, 138, 4, 0.45)";
const NOTE_HEADER_BG = "rgba(250, 204, 21, 0.5)";
const NOTE_HEADER_BORDER = "rgba(202, 138, 4, 0.35)";
const NOTE_ACCENT = "#92400e";
const NOTE_INK = "#422006";
const NOTE_PLACEHOLDER_INK = "rgba(66, 32, 6, 0.45)";

const editing = ref(false);
const textBuffer = ref(props.data.text);

watch(
	() => props.data.text,
	(v) => {
		if (!editing.value) textBuffer.value = v;
	},
);

function commitText() {
	editing.value = false;
	const next = textBuffer.value;
	if (next !== props.data.text) {
		props.data.onTextChange(props.data.noteId, next);
	}
}
</script>

<template>
	<div
		class="rounded-lg shadow-md border relative overflow-hidden flex flex-col"
		:class="{ 'ring-2 ring-primary': selected }"
		:style="{
			background: data.color ?? NOTE_DEFAULT_BG,
			borderColor: NOTE_BORDER,
			width: `${data.width}px`,
			height: `${data.height}px`,
		}"
		@dblclick="editing = true"
	>
		<!-- Header strip: gives the note a recognisable sticky-note frame and
		     hosts the delete affordance without overlapping the text. -->
		<div
			class="flex items-center justify-between h-6 px-2 shrink-0 cursor-grab"
			:style="{
				background: NOTE_HEADER_BG,
				borderBottom: `1px solid ${NOTE_HEADER_BORDER}`,
			}"
		>
			<UIcon
				name="i-ph-note-pencil"
				class="size-3.5"
				:style="{ color: NOTE_ACCENT }"
			/>
			<button
				v-if="selected"
				type="button"
				class="p-0.5 rounded hover:bg-black/10"
				:style="{ color: NOTE_ACCENT }"
				:aria-label="$t('dms_database.diagram.notes.delete')"
				@click.stop="data.onDelete(data.noteId)"
			>
				<UIcon name="i-ph-x" class="size-3.5" />
			</button>
		</div>
		<!-- Body. Fixed dark ink so the text stays readable on the light note in
		     any app theme (the previous theme-aware text colour washed out). -->
		<textarea
			v-if="editing"
			v-model="textBuffer"
			class="flex-1 w-full bg-transparent text-sm p-3 resize-none outline-none"
			:style="{ color: NOTE_INK }"
			:placeholder="$t('dms_database.diagram.notes.placeholder')"
			autofocus
			@blur="commitText"
			@keydown.escape.prevent="commitText"
		/>
		<div
			v-else
			class="flex-1 w-full p-3 text-sm whitespace-pre-wrap break-words cursor-text overflow-auto"
			:style="{ color: data.text ? NOTE_INK : NOTE_PLACEHOLDER_INK }"
		>
			{{ data.text || $t("dms_database.diagram.notes.placeholder") }}
		</div>
	</div>
</template>
