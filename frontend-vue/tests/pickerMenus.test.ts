import { describe, expect, it } from 'vitest'
import {
	CROSS_INSTANCE_VALUE,
	DEFAULT_INSTANCE_VALUE,
	instanceChoiceOf,
	tabInstanceOf,
} from '../app/build/composables/useDataBrowserTabs'
import {
	PICK_ALL,
	PICK_DEFAULT,
	instanceMenu,
	instancePickChoice,
	instancePickValue,
	schemaMenu,
	type InstanceMenu,
	type PickerItem,
} from '../app/build/data/pickerMenus'
import { sortNames } from '../app/build/data/instanceOptions'

// The schema and instance pickers the Schemas page's filter bar and the data
// browser's sidebar share (SchemaPicker.vue, InstancePicker.vue).

const values = (groups: PickerItem[][]) =>
	groups.map((group) => group.map((item) => item.value ?? `#${item.label}`))

const schemaLabels = {
	more: (shown: number, total: number) => `First ${shown} of ${total}`,
}

describe('schema picker menu', () => {
	const ids = sortNames(['shop', 'demo', 'core'])

	it('pins "All schemas" first when the page lists every schema', () => {
		const groups = schemaMenu({
			ids,
			search: '',
			allLabel: 'All schemas',
			...schemaLabels,
		})
		expect(values(groups)).toEqual([[PICK_ALL], ['core', 'demo', 'shop']])
		expect(groups[0]?.[0]?.class).toBe('pin-top')
	})

	it('offers no "All schemas" when a schema is required', () => {
		expect(
			values(
				schemaMenu({
					ids,
					search: '',
					allLabel: null,
					...schemaLabels,
				}),
			),
		).toEqual([['core', 'demo', 'shop']])
	})

	it('searches every schema', () => {
		expect(
			values(
				schemaMenu({
					ids,
					search: 'o',
					allLabel: null,
					...schemaLabels,
				}),
			),
		).toEqual([['core', 'demo', 'shop']])
	})

	it('says how many matched beyond the ones listed', () => {
		const many = sortNames(
			Array.from({ length: 150 }, (_, index) => `module-${index}`),
		)
		const groups = schemaMenu({
			ids: many,
			search: '',
			allLabel: null,
			...schemaLabels,
		})
		expect(groups[0]?.at(-1)).toEqual({
			label: 'First 100 of 150',
			type: 'label',
		})
	})
})

function menu(overrides: Partial<InstanceMenu>): InstanceMenu {
	return {
		search: '',
		hasSchema: true,
		names: [],
		matched: 0,
		total: null,
		status: 'idle',
		allMode: 'filter',
		labels: {
			all: 'All instances',
			readOnly: 'Read-only view',
			default: 'default',
			pickSchema: 'Pick a schema',
			loading: 'Loading',
			failed: 'Failed',
			noNamed: 'No named instance',
			noMatch: 'No instance matches',
			more: (shown, total) => `First ${shown} of ${total}`,
			count: (value) => String(value),
		},
		...overrides,
	}
}

describe('instance picker menu', () => {
	it('pins every instance, counted, and default first as a filter', () => {
		const groups = instanceMenu(
			menu({ names: ['eu', 'us'], matched: 2, total: 2, status: 'success' }),
		)
		expect(values(groups)).toEqual([
			[PICK_ALL, PICK_DEFAULT],
			['eu', 'us'],
		])
		expect(groups[0]?.[0]).toMatchObject({
			label: 'All instances (3)',
			icon: 'i-ph-stack-simple',
			class: 'pin-top',
		})
	})

	it('offers every instance first, locked, as the read-only view', () => {
		const groups = instanceMenu(
			menu({
				names: ['eu'],
				matched: 1,
				total: 1,
				status: 'success',
				allMode: 'readonly',
			}),
		)
		expect(values(groups)).toEqual([[PICK_ALL, PICK_DEFAULT], ['eu']])
		expect(groups[0]?.[0]).toMatchObject({
			label: 'All instances (2)',
			description: 'Read-only view',
			icon: 'i-ph-lock-simple',
			class: 'pin-top',
		})
	})

	it('keeps the read-only view after the matches of a search', () => {
		const groups = instanceMenu(
			menu({
				search: 'zz',
				total: 4,
				status: 'success',
				allMode: 'readonly',
			}),
		)
		expect(values(groups)).toEqual([['#No instance matches'], [PICK_ALL]])
		expect(groups[1]?.[0]?.class).toBeUndefined()
		expect(
			values(
				instanceMenu(
					menu({
						search: 'e',
						names: ['eu'],
						matched: 1,
						total: 4,
						status: 'success',
						allMode: 'readonly',
					}),
				),
			),
		).toEqual([[PICK_DEFAULT], ['eu'], [PICK_ALL]])
	})

	it('lists the "all" filter after the matches, or drops it', () => {
		expect(
			values(
				instanceMenu(
					menu({
						search: 'all',
						names: ['ball'],
						matched: 1,
						status: 'success',
					}),
				),
			),
		).toEqual([['ball'], [PICK_ALL]])
	})

	it('drops the "all" filter a search does not match', () => {
		expect(
			values(
				instanceMenu(
					menu({ search: 'eu', names: ['eu'], matched: 1, status: 'success' }),
				),
			),
		).toEqual([['eu']])
	})

	it('says the instances load, failed, or are more than listed', () => {
		expect(values(instanceMenu(menu({ status: 'pending' })))[1]).toEqual([
			'#Loading',
		])
		expect(values(instanceMenu(menu({ status: 'error' })))[1]).toEqual([
			'#Failed',
		])
		expect(
			values(
				instanceMenu(
					menu({ status: 'success', total: 0, matched: 0, names: [] }),
				),
			)[1],
		).toEqual(['#No named instance'])
		expect(
			values(
				instanceMenu(
					menu({
						status: 'success',
						names: ['tenant-1'],
						matched: 500,
						total: 500,
					}),
				),
			)[1],
		).toEqual(['tenant-1', '#First 1 of 500'])
	})

	it('asks for a schema before listing named instances', () => {
		for (const allMode of ['filter', 'readonly'] as const)
			expect(values(instanceMenu(menu({ hasSchema: false, allMode })))).toEqual(
				[[PICK_ALL, PICK_DEFAULT], ['#Pick a schema']],
			)
	})

	it('maps choices to menu values and back', () => {
		for (const choice of [
			{ kind: 'all' },
			{ kind: 'default' },
			{ kind: 'named', id: 'eu' },
		] as const)
			expect(instancePickChoice(instancePickValue(choice))).toEqual(choice)
	})

	it('maps a data-browser tab instance to a choice and back', () => {
		for (const instance of [
			DEFAULT_INSTANCE_VALUE,
			CROSS_INSTANCE_VALUE,
			'eu',
			'all',
		])
			expect(tabInstanceOf(instanceChoiceOf(instance))).toBe(instance)
		expect(instanceChoiceOf(CROSS_INSTANCE_VALUE)).toEqual({ kind: 'all' })
		expect(instanceChoiceOf('all')).toEqual({ kind: 'named', id: 'all' })
	})
})
