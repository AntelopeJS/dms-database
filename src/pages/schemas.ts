import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

@RegisterPage()
export class DatabaseSchemasPage extends PageController(
  "schemas",
  {
    displayName: "$dms_database.schemas.title",
    description: "$dms_database.schemas.description",
    icon: "i-ph-stack",
    module: "database",
    order: 1,
  },
  DefaultLayout({ hideHeader: true, fullWidth: true }),
) {
  static content = CustomComponent("DmsDatabaseSchemas").meta({
    name: "$dms_database.schemas.title",
    icon: "i-ph-stack",
  });
}
