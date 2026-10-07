<script setup lang="ts">
import { cellText, isStructured } from '../build/data/cellValues'
import type { StagedCell } from '../build/data/stagedEdits'
import type { ColumnRole } from '../build/utils/fieldTypes'

// One cell of the data grid. A staged cell is tinted, with the stored value
// struck through before the new one; nothing is written until the changes
// are saved.

const props = defineProps<{
	value: unknown
	staged?: StagedCell
	role: ColumnRole
	editable: boolean
	editing: boolean
	/** Why the draft was refused, shown under the editor. */
	invalid?: string
	focused: boolean
}>()

const emit = defineEmits<{
	select: []
	'start-edit': []
	commit: [draft: string | boolean, source: 'enter' | 'blur']
	cancel: []
}>()

const shown = computed(() => (props.staged ? props.staged.after : props.value))
const isNull = computed(() => shown.value === null || shown.value === undefined)
const structured = computed(() => isStructured(shown.value))
const isNumber = computed(() => typeof shown.value === 'number')
// "{3}" for an object of three keys, "[2]" for a list of two items.
const sizeTag = computed(() => {
	if (!structured.value) return ''
	const size = Object.keys(shown.value as object).length
	return Array.isArray(shown.value) ? `[${size}]` : `{${size}}`
})

const draft = ref('')
const boolDraft = ref(false)
const cellInput = useTemplateRef<HTMLInputElement | HTMLSelectElement>(
	'cellInput',
)
// Set before blurring on Escape so the blur does not commit after a cancel.
const cancelling = ref(false)

watch(
	() => props.editing,
	(editing) => {
		if (!editing) return
		cancelling.value = false
		if (typeof shown.value === 'boolean') boolDraft.value = shown.value
		else draft.value = cellText(shown.value)
		nextTick(() => {
			cellInput.value?.focus()
			if (cellInput.value instanceof HTMLInputElement) cellInput.value.select()
		})
	},
)

function commit(source: 'enter' | 'blur') {
	if (cancelling.value) return
	emit(
		'commit',
		typeof shown.value === 'boolean' ? boolDraft.value : draft.value,
		source,
	)
}

function cancel() {
	cancelling.value = true
	emit('cancel')
}
</script>

<template>
	<td
		class="border-default relative cursor-default border-b border-r p-0 align-middle"
		:class="[
			invalid
				? 'ring-error ring-2 ring-inset'
				: focused
					? 'ring-primary ring-2 ring-inset'
					: '',
			staged ? 'bg-warning/10' : editing ? 'bg-primary/5' : '',
		]"
		:title="
			staged
				? $t('dms_database.data.grid.staged_title', {
						before: cellText(staged.before) || 'null',
					})
				: undefined
		"
		@click="emit('select')"
		@dblclick="editable && emit('start-edit')"
	>
		<template v-if="editing">
			<select
				v-if="typeof shown === 'boolean'"
				ref="cellInput"
				v-model="boolDraft"
				class="bg-default w-full px-2 py-1 font-mono text-[12.5px] outline-none"
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
				class="bg-default w-full px-2 py-1 font-mono text-[12.5px] outline-none"
				:aria-invalid="invalid ? true : undefined"
				@keydown.enter.prevent="commit('enter')"
				@keydown.esc.stop="cancel"
				@keydown.stop
				@blur="commit('blur')"
			/>
			<span
				v-if="invalid"
				class="bg-error text-inverted absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded px-2 py-1 text-[11px] shadow"
			>
				{{ invalid }}
			</span>
		</template>
		<div
			v-else
			class="flex items-center gap-1.5 overflow-hidden whitespace-nowrap px-2.5 py-1"
			:class="isNumber ? 'justify-end' : ''"
		>
			<s v-if="staged" class="text-dimmed font-mono text-[11.5px]">
				{{ cellText(staged.before) || 'null' }}
			</s>
			<span
				v-if="isNull"
				class="text-dimmed rounded border border-dashed border-current px-1 font-mono text-[10px]"
			>
				null
			</span>
			<template v-else-if="structured">
				<span
					class="bg-elevated text-muted shrink-0 rounded px-1 font-mono text-[10px]"
				>
					{{ sizeTag }}
				</span>
				<span
					class="text-muted overflow-hidden text-ellipsis font-mono text-[12px]"
				>
					{{ cellText(shown) }}
				</span>
			</template>
			<span
				v-else
				class="overflow-hidden text-ellipsis font-mono text-[12.5px] tabular-nums"
				:class="[
					role === 'key'
						? 'text-muted'
						: role === 'relation'
							? 'text-primary'
							: 'text-toned',
					staged ? 'text-highlighted font-medium' : '',
				]"
			>
				{{ cellText(shown) }}
			</span>
			<UIcon
				v-if="role === 'relation' && !isNull"
				name="i-ph-arrow-up-right"
				class="text-primary size-3 shrink-0"
			/>
		</div>
	</td>
</template>
