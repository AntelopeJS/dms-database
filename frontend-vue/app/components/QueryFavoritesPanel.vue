<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type { QueryScope, SavedQuery } from "../composables/useQueryStore";
import { formatRelativeTime } from "../utils/relativeTime";

interface Props {
	items: SavedQuery[];
	scope: QueryScope;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	"update:scope": [value: QueryScope];
	load: [query: SavedQuery];
	edit: [query: SavedQuery];
	delete: [id: string];
}>();

const { t } = useI18n();
const { user } = useUserSession();

const internalScope = computed<QueryScope>({
	get: () => props.scope,
	set: (value) => emit("update:scope", value),
});

const scopeItems = computed(() => [
	{ label: t("dms_database.query.scopeMe"), value: "me" as const },
	{ label: t("dms_database.query.scopeShared"), value: "shared" as const },
]);

function menuItems(item: SavedQuery): DropdownMenuItem[][] {
	const load: DropdownMenuItem = {
		label: t("dms_database.query.itemMenu.load"),
		icon: "i-ph-arrow-square-out",
		onSelect: () => emit("load", item),
	};
	// The Team tab also lists other users' queries; only the owner may edit
	// or delete them (the API enforces the same rule).
	if (item.userId !== user.value?._id) return [[load]];
	return [
		[
			load,
			{
				label: t("dms_database.query.itemMenu.edit"),
				icon: "i-ph-pencil-simple",
				onSelect: () => emit("edit", item),
			},
		],
		[
			{
				label: t("dms_database.query.itemMenu.delete"),
				icon: "i-ph-trash",
				color: "error",
				onSelect: () => emit("delete", item.id),
			},
		],
	];
}
</script>

<template>
	<DmsCard :padded="false" class="flex flex-col">
		<header class="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
			<UIcon name="i-ph-star" class="text-primary shrink-0" />
			<h3 class="text-highlighted text-sm font-semibold">
				{{ $t("dms_database.query.favorites") }}
			</h3>
			<DmsSegmented
				v-model="internalScope"
				:items="scopeItems"
				:aria-label="$t('dms_database.query.scopeMe')"
				class="ml-auto"
			/>
		</header>

		<ul
			v-if="items.length > 0"
			class="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5"
		>
			<li
				v-for="item in items"
				:key="item.id"
				class="group flex items-center gap-2.5 rounded-md px-2.5 py-2.5 cursor-pointer hover:bg-elevated transition-colors"
				@click="emit('load', item)"
				@keydown.enter.prevent="emit('load', item)"
			>
				<UIcon name="i-ph-star-fill" class="text-primary shrink-0 size-3.5" />
				<div class="min-w-0 flex-1">
					<div
						class="text-toned text-[12.5px] font-semibold truncate flex items-center gap-1.5"
					>
						<span class="truncate">{{ item.name }}</span>
						<UIcon
							v-if="item.shared"
							name="i-ph-users"
							class="text-info shrink-0 size-3.5"
							:aria-label="$t('dms_database.query.sharedBadge')"
						/>
					</div>
				</div>
				<span class="text-dimmed font-mono text-[10.5px] shrink-0">
					{{ formatRelativeTime(item.createdAt) }}
				</span>
				<UDropdownMenu :items="menuItems(item)" :content="{ align: 'end' }">
					<UButton
						icon="i-ph-dots-three-vertical"
						variant="ghost"
						color="neutral"
						size="xs"
						class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
						:aria-label="item.name"
						@click.stop
					/>
				</UDropdownMenu>
			</li>
		</ul>

		<div
			v-else
			class="flex-1 flex items-center justify-center px-4 py-6 text-xs text-dimmed text-center"
		>
			{{ $t("dms_database.query.emptyFavorites") }}
		</div>
	</DmsCard>
</template>
