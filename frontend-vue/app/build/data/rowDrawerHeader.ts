// The header a data browser row drawer is opened with: the DMS row header
// (dms#375), as the DMS draws it over a row drawer a table action opens. The
// drawer is opened with `useDrawer`, so the module hands the DMS's component
// its options itself. A DMS without it draws its plain title instead.

/** The DMS row header's registered name. */
export const ROW_HEADER_COMPONENT = 'DmsRowHeader'

/** The position over the rows of the page, "Row 3 of 50". */
export const ROW_POSITION_KEY = 'dms_database.data.row.position'

// As the DMS words a row drawer's header (`useActionTargets`): the parts its
// tests and styles find, the drawer title's type.
const ROW_HEADER_PART = 'dms-row-drawer'
const ROW_HEADING_CLASS =
	'text-[17px] leading-[1.3] font-[650] tracking-[-0.02em]'

/** What a drawer opened on a row receives to step through the rows. */
export interface RowNavigation {
	/** From 0. */
	index: number
	total: number
	hasPrev: boolean
	hasNext: boolean
	prev: () => void
	next: () => void
}

// A type, not an interface: the drawer takes its header's options as a
// `Record<string, unknown>`.
export type RowHeaderOptions = {
	part: string
	heading: string
	/** i18n key (`$`-prefixed) receiving `{ index, total }`. */
	positionLabel: string
	navigation: RowNavigation
	headingClass: string
}

/** The DMS row header's props for the row `heading` names. */
export function rowHeaderOptions(
	heading: string,
	navigation: RowNavigation,
): RowHeaderOptions {
	return {
		part: ROW_HEADER_PART,
		heading,
		positionLabel: `$${ROW_POSITION_KEY}`,
		navigation,
		headingClass: ROW_HEADING_CLASS,
	}
}
