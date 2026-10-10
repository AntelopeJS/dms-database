import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DATABASE_MODULE_ID, workSection } from "../module";

@RegisterPage()
export class DatabaseDataPage extends PageController(
  "data",
  {
    displayName: "$dms_database.data.title",
    description: "$dms_database.data.description",
    icon: "i-ph-rows",
    module: DATABASE_MODULE_ID,
    category: workSection,
    order: 0,
  },
  DefaultLayout({ fillHeight: true }),
) {
  static browser = CustomComponent("DmsDatabaseDataBrowser").meta({
    name: "$dms_database.data.meta",
    icon: "i-ph-rows",
    description: "$dms_database.data.meta_description",
  });
}
