import { guarded } from "../guard.mjs";
import { layoutApi, notesApi, notesRefusals, ownerOnly } from "./parts/diagram-api.mjs";

/** The Diagram page: its tables, folds, layout, notes, shortcuts and the routes behind them. */
export const journeys = guarded([layoutApi, notesApi, notesRefusals, ownerOnly]);
