import { browseApiJourneys } from "./parts/browse-api.mjs";
import { gridJourneys } from "./parts/browse-grid.mjs";
import { sidebarJourneys } from "./parts/browse-sidebar.mjs";

/** The Data browser: reading rows. */
export const journeys = [...browseApiJourneys, ...sidebarJourneys, ...gridJourneys];
