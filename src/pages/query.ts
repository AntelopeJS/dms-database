import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

@RegisterPage()
export class DatabaseQueryPage extends PageController(
  "query",
  {
    displayName: "$dms_database.query.title",
    description: "$dms_database.query.description",
    icon: "i-ph-code",
    module: "database",
    order: 3,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsDatabaseQuery").meta({
    name: "$dms_database.query.title",
    icon: "i-ph-code",
  });
}
