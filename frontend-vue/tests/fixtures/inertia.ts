import { reactive } from 'vue'

interface VisitOptions {
	url: string
	onFinish?: (visit: Record<string, never>) => void
}

interface InertiaState {
	page: { url?: string }
	visits: string[]
}

/** The page Inertia reports and the visits the router made, as `kind url`. */
export const inertia: InertiaState = {
	page: reactive({ url: undefined }),
	visits: [],
}

const visit = (kind: string) => (options: VisitOptions) => {
	inertia.visits.push(`${kind} ${options.url}`)
	options.onFinish?.({})
}

export const Link = {}
export const router = {
	visit: () => undefined,
	on: () => () => undefined,
	push: visit('push'),
	replace: visit('replace'),
}
export const usePage = () => inertia.page
