import { guarded } from "../guard.mjs";
import { finding, foldRule, folding, modifierIcons, notSaved, reading, startView } from "./parts/diagram-read.mjs";
import { crossSchema, deepLinks, emptySchema, stubs } from "./parts/diagram-links.mjs";
import { dragging, placement } from "./parts/diagram-layout.mjs";
import { layoutApi, notesApi, notesRefusals, ownerOnly } from "./parts/diagram-api.mjs";

/** The Diagram page: its tables, folds, layout, notes, shortcuts and the routes behind them. */
export const journeys = guarded([layoutApi, notesApi, notesRefusals, ownerOnly, reading, modifierIcons, folding, foldRule, notSaved, finding, startView, stubs, crossSchema, deepLinks, emptySchema, dragging, placement]);
