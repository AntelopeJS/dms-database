import { guarded } from "../guard.mjs";
import { eachFilter, noResult, restored, slash } from "./parts/schema-filters-ui.mjs";
import { columnsOfTags, sorting } from "./parts/schema-list-ui.mjs";
import { resizing, stepping } from "./parts/schema-inspector.mjs";
import { factsAndColumns, indexesAndRelations, quirkColumn, sampleRow } from "./parts/schema-tabs.mjs";
import { actions } from "./parts/schema-actions.mjs";
import { filters, inference, instanceCounts, instanceSearch, ownerOnly, singleRow, tableCounts } from "./parts/schema-source.mjs";

/** The Schemas page: its tables, filters, sorting, inspector and the routes behind them. */
export const journeys = guarded([tableCounts, filters, instanceCounts, instanceSearch, singleRow, inference, ownerOnly, eachFilter, restored, slash, noResult, sorting, columnsOfTags, stepping, resizing, factsAndColumns, quirkColumn, indexesAndRelations, sampleRow, actions]);
