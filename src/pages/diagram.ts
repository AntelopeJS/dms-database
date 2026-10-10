import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DATABASE_MODULE_ID, DATABASE_PATHS, exploreSection } from "../module";

@RegisterPage()
export class DatabaseDiagramPage extends PageController(
  "diagram",
  {
    displayName: "$dms_database.diagram.title",
    description: "$dms_database.diagram.description",
    icon: "i-ph-graph",
    module: DATABASE_MODULE_ID,
    category: exploreSection,
    order: 2,
  },
  DefaultLayout({
    fillHeight: true,
    headerActions: [
      {
        id: "open-list",
        label: "$dms_database.diagram.actions.list",
        icon: "i-ph-rows",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: DATABASE_PATHS.schemas },
      },
    ],
  }),
) {
  static canvas = CustomComponent("DmsDatabaseSchemaDiagram").meta({
    name: "$dms_database.diagram.meta",
    icon: "i-ph-graph",
    description: "$dms_database.diagram.meta_description",
  });
}
