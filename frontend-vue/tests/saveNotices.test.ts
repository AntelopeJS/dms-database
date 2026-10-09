import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
	liveNotice,
	type SaveNotice,
	useSaveNotices,
} from '../app/build/data/saveNotices'

afterEach(() => vi.unstubAllGlobals())

function notice(until: number): SaveNotice {
	return { state: 'saved', changes: [], scope: 'shop.orders @eu', until }
}

describe('save notices', () => {
	it('shows a tab its notice until it runs out', () => {
		const notices = { tab: notice(1_000) }
		expect(liveNotice(notices, 'tab', 999)).toEqual(notices.tab)
		expect(liveNotice(notices, 'tab', 1_000)).toBeNull()
		expect(liveNotice(notices, 'other', 0)).toBeNull()
	})

	it('ends a notice and drops the spent ones', () => {
		vi.stubGlobal('useDmsState', (_key: string, init: () => unknown) =>
			ref(init()),
		)
		const now = Date.now()
		const { notices, set } = useSaveNotices()
		notices.value = { spent: notice(now - 1), kept: notice(now + 60_000) }
		set('tab', notice(now + 10_000))
		expect(Object.keys(notices.value).sort()).toEqual(['kept', 'tab'])
		set('tab', null)
		expect(Object.keys(notices.value)).toEqual(['kept'])
	})
})
