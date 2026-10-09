<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import type { NoteNodeData } from '../build/diagram/graph'

// A sticky note on the diagram: double-click to write, saved with the layout.
// A click anywhere else, or Escape, ends the edit.
const props = defineProps<{
	data: NoteNodeData
	selected?: boolean
	/** Set by Vue Flow once it has measured the node. */
	dimensions?: { width: number; height: number }
}>()

const root = useTemplateRef<HTMLElement>('root')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
const editing = ref(false)
const textBuffer = ref(props.data.text)

watch(
	() => props.data.text,
	(value) => {
		if (!editing.value) textBuffer.value = value
	},
)

// Vue Flow shows a new node only once it has measured it: until then the
// field cannot take the focus. It is tried again when the node's size comes
// in, and on the next frames.
const FOCUS_FRAMES = 10
let focusPending = false

function focusField(framesLeft = FOCUS_FRAMES) {
	const field = textarea.value
	if (!focusPending || !field || !editing.value) return
	field.focus()
	if (document.activeElement === field) {
		focusPending = false
		field.setSelectionRange(field.value.length, field.value.length)
		return
	}
	if (framesLeft > 0) requestAnimationFrame(() => focusField(framesLeft - 1))
}

watch(
	() => props.dimensions?.width,
	() => focusField(0),
	{ flush: 'post' },
)

async function startEdit() {
	if (editing.value) return
	textBuffer.value = props.data.text
	editing.value = true
	focusPending = true
	await nextTick()
	focusField()
}

function commitText() {
	if (!editing.value) return
	editing.value = false
	focusPending = false
	if (textBuffer.value !== props.data.text) {
		props.data.onTextChange(props.data.noteId, textBuffer.value)
	}
	props.data.onEditEnd(props.data.noteId)
}

// The canvas swallows the pointer down that would blur the field: a click on
// the pane or a table has to end the edit itself.
onClickOutside(root, () => {
	if (editing.value) commitText()
})

// A note just created opens ready to write.
onMounted(() => {
	if (props.data.autoEdit) startEdit()
})
</script>

<template>
	<div
		ref="root"
		class="bg-warning/10 border-warning/40 text-toned relative flex flex-col overflow-hidden rounded-sm border shadow-sm backdrop-blur-sm"
		:class="{ 'ring-warning ring-2': selected || editing }"
		:style="{ width: `${data.width}px`, height: `${data.height}px` }"
		@dblclick="startEdit"
	>
		<div
			class="text-warning flex h-7 shrink-0 cursor-grab items-center gap-1.5 px-3"
		>
			<UIcon name="i-ph-note-pencil" class="size-3.5" />
			<span
				class="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
			>
				{{ $t('dms_database.diagram.notes.label') }}
			</span>
			<button
				v-if="selected || editing"
				type="button"
				class="nodrag hover:bg-warning/20 ml-auto rounded p-0.5"
				:aria-label="$t('dms_database.diagram.notes.delete')"
				:title="$t('dms_database.diagram.notes.delete')"
				@pointerdown.stop
				@click.stop="data.onDelete(data.noteId)"
			>
				<UIcon name="i-ph-trash" class="size-3.5" />
			</button>
		</div>
		<textarea
			v-if="editing"
			ref="textarea"
			v-model="textBuffer"
			class="nodrag nowheel w-full flex-1 resize-none bg-transparent px-3 pb-3 text-[12.5px] leading-normal outline-none"
			:placeholder="$t('dms_database.diagram.notes.placeholder')"
			@blur="commitText"
			@keydown.escape.prevent.stop="commitText"
		/>
		<div
			v-else
			class="w-full flex-1 cursor-text overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-[12.5px] leading-normal"
			:class="data.text ? '' : 'text-dimmed'"
		>
			{{ data.text || $t('dms_database.diagram.notes.placeholder') }}
		</div>
	</div>
</template>
