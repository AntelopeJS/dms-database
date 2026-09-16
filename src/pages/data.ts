import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

@RegisterPage()
export class DatabaseDataPage extends PageController(
  "data",
  {
    displayName: "$dms_database.data.title",
    description: "$dms_database.data.description",
    icon: "i-ph-rows",
    module: "database",
    order: 2,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsDatabaseData").meta({
    name: "$dms_database.data.title",
    icon: "i-ph-rows",
  });
}
