import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DATABASE_MODULE_ID, DATABASE_PATHS, workSection } from "../module";

@RegisterPage()
export class DatabaseQueryPage extends PageController(
  "query",
  {
    displayName: "$dms_database.query.title",
    description: "$dms_database.query.description",
    icon: "i-ph-code",
    module: DATABASE_MODULE_ID,
    category: workSection,
    order: 1,
  },
  DefaultLayout({
    fillHeight: true,
    headerActions: [
      {
        id: "open-data",
        label: "$dms_database.query.actions.data",
        icon: "i-ph-rows",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: DATABASE_PATHS.data },
      },
    ],
  }),
) {
  static console = CustomComponent("DmsDatabaseQueryConsole").meta({
    name: "$dms_database.query.meta",
    icon: "i-ph-code",
    description: "$dms_database.query.meta_description",
  });
}
