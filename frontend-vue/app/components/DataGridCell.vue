<script setup lang="ts">
import {
	cellLabel,
	cellText,
	draftText,
	isStructured,
} from '../build/data/cellValues'
import type { StagedCell } from '../build/data/stagedEdits'
import { READ_ONLY_REASON } from '../build/data/readOnlyReason'
import {
	type CellValue,
	isBoolean,
	isNumber as isNumberValue,
	isObject,
} from '../build/utils/values'
import type { ColumnRole } from '../build/utils/fieldTypes'

const props = defineProps<{
	/** The column's name, which names the editor for assistive technology. */
	column: string
	value: CellValue
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

const readOnlyReason = inject(READ_ONLY_REASON, ref<string | null>(null))
const shown = computed(() => (props.staged ? props.staged.after : props.value))
const isNull = computed(() => shown.value === null || shown.value === undefined)
const isEmptyText = computed(() => shown.value === '')
const structured = computed(() => isStructured(shown.value))
const isNumber = computed(() => isNumberValue(shown.value))
const sizeTag = computed(() => {
	const value = shown.value
	if (!structured.value || !isObject(value)) return ''
	const size = Object.keys(value).length
	return Array.isArray(value) ? `[${size}]` : `{${size}}`
})

const draft = ref('')
const boolDraft = ref(false)
const cellInput = useTemplateRef<HTMLInputElement | HTMLSelectElement>(
	'cellInput',
)
const cancelling = ref(false)

watch(
	() => props.editing,
	async (editing) => {
		if (!editing) return
		cancelling.value = false
		if (isBoolean(shown.value)) boolDraft.value = shown.value
		else draft.value = draftText(shown.value)
		await nextTick()
		cellInput.value?.focus()
		if (cellInput.value instanceof HTMLInputElement) cellInput.value.select()
	},
)

function commit(source: 'enter' | 'blur') {
	if (cancelling.value) return
	emit('commit', isBoolean(shown.value) ? boolDraft.value : draft.value, source)
}

function cancel() {
	cancelling.value = true
	emit('cancel')
}
</script>

<template>
	<td
		class="border-default relative border-b border-r p-0 align-middle"
		:class="[
			invalid
				? 'ring-error ring-2 ring-inset'
				: focused
					? 'ring-primary ring-2 ring-inset'
					: '',
			staged ? 'bg-warning/10' : editing ? 'bg-primary/5' : '',
			readOnlyReason ? 'cursor-not-allowed' : 'cursor-default',
		]"
		:title="
			staged
				? $t('dms_database.data.grid.staged_title', {
						before: cellLabel(staged.before),
					})
				: (readOnlyReason ?? undefined)
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
				:aria-label="$t('dms_database.data.grid.edit_cell', { column })"
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
				:aria-label="$t('dms_database.data.grid.edit_cell', { column })"
				:title="$t('dms_database.data.grid.null_hint')"
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
				{{ cellLabel(staged.before) }}
			</s>
			<span
				v-if="isNull"
				class="text-dimmed rounded border border-dashed border-current px-1 font-mono text-[10px]"
			>
				null
			</span>
			<span
				v-else-if="isEmptyText"
				class="text-dimmed font-mono text-[12.5px]"
				:title="$t('dms_database.data.grid.empty_text')"
			>
				""
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
