import { ref } from 'vue'

/** What the module's shared states start as: a count, a name or none, an empty list or an empty record. */
export type InitialState =
	| string
	| number
	| null
	| never[]
	| Record<string, never>

/** `useDmsState` as the renderer gives it: a new ref made from `init` on every call. */
export const freshState = (_key: string, init: () => InitialState) =>
	ref(init())

/** `useDmsState` as the renderer gives it: one ref per key, made from the first call's `init`. */
export function sharedState() {
	const states = new Map<string, ReturnType<typeof freshState>>()
	return (key: string, init: () => InitialState) => {
		const known = states.get(key)
		if (known) return known
		const created = freshState(key, init)
		states.set(key, created)
		return created
	}
}
