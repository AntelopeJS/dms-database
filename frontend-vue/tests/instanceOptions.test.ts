import { describe, expect, it } from 'vitest'
import {
	PICKER_LIMIT,
	matchNames,
	sortNames,
} from '../app/build/data/instanceOptions'

describe('instance picker', () => {
	it('sorts instances by name, numbers in order, once each', () => {
		expect(sortNames(['us', 'tenant-10', 'eu', 'tenant-9', 'eu'])).toEqual([
			'eu',
			'tenant-9',
			'tenant-10',
			'us',
		])
	})

	it('lists every instance without a search', () => {
		expect(matchNames(['eu', 'us'], '  ')).toEqual({
			shown: ['eu', 'us'],
			total: 2,
		})
	})

	it('matches a part of the name, whatever the case', () => {
		const sorted = sortNames(['acme-EU', 'acme-us', 'globex-eu'])
		expect(matchNames(sorted, 'Eu')).toEqual({
			shown: ['acme-EU', 'globex-eu'],
			total: 2,
		})
		expect(matchNames(sorted, 'initech')).toEqual({ shown: [], total: 0 })
	})

	it('renders a bounded slice of many instances and counts the rest', () => {
		const sorted = sortNames(
			Array.from({ length: 1_500 }, (_, index) => `tenant-${index}`),
		)
		const all = matchNames(sorted, '')
		expect(all.shown).toHaveLength(PICKER_LIMIT)
		expect(all.total).toBe(1_500)
		expect(all.shown[0]).toBe('tenant-0')

		const some = matchNames(sorted, 'tenant-14', 5)
		expect(some.shown).toEqual([
			'tenant-14',
			'tenant-140',
			'tenant-141',
			'tenant-142',
			'tenant-143',
		])
		expect(some.total).toBe(111)
	})
})
