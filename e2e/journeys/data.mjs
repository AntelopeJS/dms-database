import { browseApiJourneys } from "./parts/browse-api.mjs";
import { gridJourneys } from "./parts/browse-grid.mjs";
import { emptyJourneys } from "./parts/browse-empty.mjs";
import { optionJourneys } from "./parts/browse-options.mjs";
import { rowJourneys } from "./parts/browse-row.mjs";
import { stateJourneys } from "./parts/browse-states.mjs";
import { sidebarJourneys } from "./parts/browse-sidebar.mjs";

/** The Data browser: reading rows. */
export const journeys = [...browseApiJourneys, ...sidebarJourneys, ...gridJourneys, ...rowJourneys, ...stateJourneys, ...emptyJourneys, ...optionJourneys];
