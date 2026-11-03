import { drawerEditJourneys } from "./parts/edit-drawer.mjs";
import { cellJourneys } from "./parts/edit-cells.mjs";
import { partialJourneys } from "./parts/edit-partial.mjs";
import { placeJourneys } from "./parts/edit-place.mjs";
import { storeJourneys } from "./parts/edit-store.mjs";
import { tabJourneys } from "./parts/edit-tabs.mjs";
import { undoJourneys } from "./parts/edit-undo.mjs";
import { valueJourneys } from "./parts/edit-values.mjs";

/** The Data browser: staged edits. */
export const journeys = [...cellJourneys, ...valueJourneys, ...tabJourneys, ...undoJourneys, ...partialJourneys, ...placeJourneys, ...storeJourneys, ...drawerEditJourneys];
