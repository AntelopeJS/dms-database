import { guarded } from "../guard.mjs";
import { filters, inference, instanceCounts, instanceSearch, ownerOnly, singleRow, tableCounts } from "./parts/schema-source.mjs";

/** The Schemas page: its tables, filters, sorting, inspector and the routes behind them. */
export const journeys = guarded([tableCounts, filters, instanceCounts, instanceSearch, singleRow, inference, ownerOnly]);
