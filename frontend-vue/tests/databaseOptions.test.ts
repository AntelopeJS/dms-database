import { describe, expect, it } from 'vitest'
import { OWN, WAREHOUSE } from './fixtures/connections'
import { databaseOptions, focusTarget } from '../app/build/data/databaseOptions'

const t = (key: string, params?: Record<string, string>) =>
	params ? `${key} ${Object.values(params).join(' ')}` : key

describe('database options', () => {
	it('names the project database from the locale and an external one by its label', () => {
		const options = databaseOptions([OWN, WAREHOUSE], 'own', t)
		expect(options.map((option) => option.name)).toEqual([
			'dms_database.connections.own',
			'Warehouse',
		])
	})

	it('gives the project database no badge, an external one its access, and an unregistered one the reason it cannot be picked', () => {
		const shop = { ...WAREHOUSE, id: 'shop', missing: ['catalog' as const] }
		const writable = { ...WAREHOUSE, id: 'wh', access: 'read-write' as const }
		const options = databaseOptions([OWN, WAREHOUSE, writable, shop], 'own', t)
		expect(options.map((option) => option.badge)).toEqual([
			null,
			{
				label: 'dms_database.connections.switcher.access_read',
				tone: 'neutral',
			},
			{
				label: 'dms_database.connections.switcher.access_read_write',
				tone: 'primary',
			},
			{
				label: 'dms_database.connections.switcher.unregistered',
				tone: 'warning',
			},
		])
		expect(options.map((option) => option.unavailable === null)).toEqual([
			true,
			true,
			true,
			false,
		])
		expect(options[3]?.unavailable).toContain('missing_catalog')
	})

	it('marks only the selected database as current', () => {
		const options = databaseOptions([OWN, WAREHOUSE], 'warehouse', t)
		expect(options.map((option) => option.current)).toEqual([false, true])
	})
})

describe('switcher keyboard focus', () => {
	it.each([
		['ArrowDown', 0, 3, 1],
		['ArrowDown', 2, 3, 0],
		['ArrowDown', -1, 3, 0],
		['ArrowUp', 1, 3, 0],
		['ArrowUp', 0, 3, 2],
		['ArrowUp', -1, 3, 2],
		['Home', 2, 3, 0],
		['End', 0, 3, 2],
	])('%s from %i of %i rows lands on %i', (key, current, count, expected) => {
		expect(focusTarget(current, count, key)).toBe(expected)
	})

	it('leaves other keys and an empty list alone, which a handler swallowing every key gets wrong', () => {
		expect(focusTarget(0, 3, 'a')).toBeUndefined()
		expect(focusTarget(0, 3, 'Tab')).toBeUndefined()
		expect(focusTarget(-1, 0, 'ArrowDown')).toBeUndefined()
	})
})
