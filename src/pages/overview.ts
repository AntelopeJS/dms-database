import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

@RegisterPage()
export class DatabaseOverviewPage extends PageController(
  "overview",
  {
    displayName: "$dms_database.overview.title",
    description: "$dms_database.overview.description",
    icon: "i-ph-gauge",
    module: "database",
    order: 0,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsDatabaseOverview").meta({
    name: "$dms_database.overview.title",
    icon: "i-ph-gauge",
  });
}
