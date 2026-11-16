import { browseJourneys } from "./parts/external-browse.mjs";
import { refusalJourneys } from "./parts/external-refusals.mjs";

/** The console on an external database: the connection the project wires, its access and its refusals. */
export const journeys = [...browseJourneys, ...refusalJourneys];
