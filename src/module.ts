import { Category, RegisterModule } from "@antelopejs/interface-dms/page";
import { readCatalogReadout } from "./service/catalog";

export const DATABASE_MODULE_ID = "database";

/** Root of the module's sidebar; every page sits in one of its sections. */
export const databaseModule = RegisterModule({
  id: DATABASE_MODULE_ID,
  title: "$dms_database.title",
  description: "$dms_database.description",
  icon: "i-ph-database",
  landingPage: "overview",
  catalogCategory: "$dms_database.catalog_category",
  // Saved edits write straight to the database while structure editing is
  // still to come: the module says so on its catalog tile too.
  status: () => "beta",
  readout: (context) => readCatalogReadout(context.user),
});

// Both sections only title the sidebar: `urlSlug: "/"` keeps them out of the
// page URLs, so every page stays at /modules/database/<page>.
export const exploreSection = Category("explore", {
  displayName: "$dms_database.nav.explore",
  icon: "i-ph-compass",
  order: 0,
  category: databaseModule,
  type: "label",
  urlSlug: "/",
});

export const workSection = Category("work", {
  displayName: "$dms_database.nav.work",
  icon: "i-ph-wrench",
  order: 1,
  category: databaseModule,
  type: "label",
  urlSlug: "/",
});

/** Where the module's pages live, for links built on the server. */
export const DATABASE_PATHS = {
  overview: "/modules/database/overview",
  schemas: "/modules/database/schemas",
  diagram: "/modules/database/diagram",
  data: "/modules/database/data",
  query: "/modules/database/query",
} as const;
