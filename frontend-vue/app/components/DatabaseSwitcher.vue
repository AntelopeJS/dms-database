<script setup lang="ts">
import { useDatabaseConnections } from '../build/composables/useDatabaseConnections'
import { confirmLeave } from '#dms-ui/app/entries/composables/unsaved-changes/registry'
import { forgetBrowserTabs } from '../build/composables/useDataBrowserTabs'
import { useLockedPages } from '../build/composables/useLockedPages'
import { useSelectionRecheck } from '../build/composables/useSelectionRecheck'
import {
	ONBOARDING_KEY,
	type PublicOnboarding,
} from '../build/data/assistantOnboarding'
import {
	databaseOptions,
	focusTarget,
	iconOf,
	nameOf,
	subtitleOf,
} from '../build/data/databaseOptions'
import DatabaseSwitcherRow from '../build/components/DatabaseSwitcherRow.vue'

const props = defineProps<{ collapsed?: boolean }>()

const KEYS = 'dms_database.connections.switcher'
const { t } = useI18n()
const route = useDmsRoute()
const { connections, selected, select, recheck } = useDatabaseConnections()
const onboarding = inject<PublicOnboarding | null>(ONBOARDING_KEY, null)
useLockedPages(selected)
useSelectionRecheck(recheck)

const isOpen = ref(false)
const switchingId = ref<string | null>(null)

const options = computed(() =>
	databaseOptions(connections.value, selected.value?.id, t),
)
const selectedName = computed(() =>
	selected.value ? nameOf(selected.value, t) : '',
)
const triggerCaption = computed(() =>
	selected.value ? subtitleOf(selected.value, t) : t(`${KEYS}.label`),
)
const triggerLabel = computed(() => selectedName.value || t(`${KEYS}.label`))
const triggerIcon = computed(() => iconOf(selected.value))
const canConnect = computed(() => onboarding?.isAvailable === true)
const popoverPlacement = computed(() =>
	props.collapsed
		? { side: 'right' as const, align: 'start' as const, sideOffset: 12 }
		: { side: 'bottom' as const, align: 'start' as const, sideOffset: 6 },
)

/** The popover stays open until the page reloads on the new database. */
async function pick(id: string) {
	const target = options.value.find((option) => option.id === id)
	if (!target || target.unavailable !== null) return
	if (switchingId.value || id === selected.value?.id) return
	switchingId.value = id
	if (!(await confirmLeave()) || !(await select(id))) {
		switchingId.value = null
		return
	}
	forgetBrowserTabs()
	window.location.assign(route.path)
}

function moveFocus(event: KeyboardEvent) {
	const list = event.currentTarget
	if (!(list instanceof HTMLElement)) return
	const rows = [...list.querySelectorAll<HTMLButtonElement>('button:enabled')]
	const target = focusTarget(
		rows.findIndex((row) => row === document.activeElement),
		rows.length,
		event.key,
	)
	if (target === undefined) return
	event.preventDefault()
	rows[target]?.focus()
}

function connect() {
	isOpen.value = false
	onboarding?.open('connect-database')
}
</script>

<template>
	<div v-if="connections.length > 0" class="px-2 pb-2" data-database-switcher>
		<UPopover v-model:open="isOpen" :content="popoverPlacement">
			<UTooltip
				:text="`${t(`${KEYS}.label`)}: ${selectedName}`"
				:disabled="!collapsed"
				:content="{ side: 'right' }"
			>
				<button
					type="button"
					class="border-default bg-elevated text-highlighted hover:border-accented focus-visible:ring-primary relative flex items-center gap-2.5 rounded-md border text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
					:class="
						collapsed ? 'size-9 justify-center p-1' : 'w-full px-2.5 py-[9px]'
					"
					:aria-label="`${t(`${KEYS}.label`)}: ${selectedName}`"
					:aria-busy="switchingId !== null || undefined"
				>
					<span
						class="from-primary-500 to-primary-600 bg-linear-to-br inline-flex size-[26px] shrink-0 items-center justify-center rounded-md text-white"
					>
						<UIcon
							:name="switchingId !== null ? 'i-ph-spinner-gap' : triggerIcon"
							class="size-4"
							:class="{ 'animate-spin': switchingId !== null }"
						/>
					</span>
					<template v-if="!collapsed">
						<span class="flex min-w-0 flex-1 flex-col leading-[1.25]">
							<span
								class="text-primary truncate font-mono text-[10px] uppercase tracking-[0.08em]"
							>
								{{ triggerCaption }}
							</span>
							<span
								class="text-highlighted truncate text-[13.5px] font-semibold tracking-[-0.01em]"
								data-database-trigger-name
							>
								{{ triggerLabel }}
							</span>
						</span>
						<UIcon
							name="i-ph-caret-up-down"
							class="text-dimmed ml-auto size-4 shrink-0"
						/>
					</template>
				</button>
			</UTooltip>

			<template #content>
				<div class="flex w-72 flex-col gap-1 p-1.5">
					<p class="text-dimmed px-2 pb-0.5 pt-1 text-[11px]">
						{{ t(`${KEYS}.menu`) }}
					</p>
					<ul
						class="m-0 flex max-h-72 list-none flex-col gap-0.5 overflow-y-auto p-0"
						:aria-label="t(`${KEYS}.title`)"
						@keydown="moveFocus"
					>
						<li v-for="option in options" :key="option.id">
							<DatabaseSwitcherRow
								:option="option"
								:is-switching="switchingId === option.id"
								:is-disabled="switchingId !== null"
								@select="pick"
							/>
						</li>
					</ul>
					<template v-if="canConnect">
						<USeparator class="my-0.5" />
						<UButton
							color="primary"
							variant="ghost"
							size="sm"
							icon="i-ph-plus"
							class="justify-start"
							:disabled="switchingId !== null"
							@click="connect"
						>
							{{ t(`${KEYS}.connect`) }}
						</UButton>
					</template>
				</div>
			</template>
		</UPopover>
	</div>
</template>
