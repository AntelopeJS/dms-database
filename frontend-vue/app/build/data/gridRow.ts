import type { GridData } from '../composables/useDataBrowserGrid'

/** One row of the grid, as the browse list reads it. */
export type GridRow = GridData['rows'][number]

/** The value of one cell of a grid row. */
export type CellValue = GridRow[string]
