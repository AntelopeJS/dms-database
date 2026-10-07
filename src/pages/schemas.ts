import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import {
  DefaultDisplays,
  TableView,
} from "@antelopejs/interface-dms/base/table-view";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { DATABASE_MODULE_ID, DATABASE_PATHS, exploreSection } from "../module";
import { addSchemaTabs } from "../service/schemaTabs";

// The row placeholders the table view fills in a page target.
const TABLE_QUERY = "schema={schema}&table={name}";

const tables = TableView.fromSource({
  caption: "$dms_database.schemas.caption",
  fetchUrl: "/api/database/tables/source",
  rowIdKey: "id",
  labelKey: "name",
  capabilities: { search: true, filter: true },
  searchPlaceholder: "$dms_database.schemas.search",
  defaultSort: { field: "elementCount", desc: true },
  pageSize: 50,
  columns: {
    name: {
      name: "$dms_database.schemas.cols.table",
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.MonoDisplay({ copy: true }),
      sortable: true,
      order: 1,
    },
    schema: {
      name: "$dms_database.schemas.cols.schema",
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.MonoDisplay(),
      filterable: true,
      isVisible: false,
      order: 2,
    },
    elementCount: {
      name: "$dms_database.schemas.cols.rows",
      type: new DefaultDataTypes.NumberType(),
      sortable: true,
      order: 3,
    },
    columnCount: {
      name: "$dms_database.schemas.cols.columns",
      type: new DefaultDataTypes.NumberType(),
      sortable: true,
      order: 4,
    },
    indexCount: {
      name: "$dms_database.schemas.cols.indexes",
      type: new DefaultDataTypes.NumberType(),
      sortable: true,
      order: 5,
    },
    relations: {
      name: "$dms_database.schemas.cols.relations",
      type: new DefaultDataTypes.TagsType(),
      order: 6,
    },
    modifiers: {
      name: "$dms_database.schemas.cols.modifiers",
      type: new DefaultDataTypes.TagsType(),
      order: 7,
    },
  },
  rowActions: {
    custom: [
      {
        label: "$dms_database.schemas.actions.inspect",
        icon: "i-ph-sidebar-simple",
        isDefault: true,
        deepLink: true,
        target: {
          type: "drawer",
          title: "$dms_database.schemas.inspector.title",
          component: CustomComponent("DmsDatabaseTableInspector").meta({
            name: "$dms_database.schemas.inspector.meta",
            icon: "i-ph-sidebar-simple",
            description: "$dms_database.schemas.inspector.meta_description",
          }),
        },
      },
      {
        label: "$dms_database.schemas.actions.browse",
        icon: "i-ph-rows",
        target: { type: "page", url: `${DATABASE_PATHS.data}?${TABLE_QUERY}` },
      },
      {
        label: "$dms_database.schemas.actions.query",
        icon: "i-ph-code",
        target: { type: "page", url: `${DATABASE_PATHS.query}?${TABLE_QUERY}` },
      },
      {
        label: "$dms_database.schemas.actions.diagram",
        icon: "i-ph-graph",
        target: {
          type: "page",
          url: `${DATABASE_PATHS.diagram}?${TABLE_QUERY}`,
        },
      },
    ],
  },
  footer: { hint: "$dms_database.schemas.footer_hint" },
  emptyStates: {
    firstRun: {
      title: "$dms_database.schemas.empty.first_title",
      description: "$dms_database.schemas.empty.first_description",
      icon: "i-ph-stack",
    },
    filtered: {
      title: "$dms_database.schemas.empty.filtered_title",
      description: "$dms_database.schemas.empty.filtered_description",
      icon: "i-ph-magnifying-glass",
    },
  },
}).meta({
  name: "$dms_database.schemas.caption",
  icon: "i-ph-table",
  description: "$dms_database.schemas.table_meta_description",
});

addSchemaTabs(tables);

@RegisterPage()
export class DatabaseSchemasPage extends PageController(
  "schemas",
  {
    displayName: "$dms_database.schemas.title",
    description: "$dms_database.schemas.description",
    icon: "i-ph-stack",
    module: DATABASE_MODULE_ID,
    category: exploreSection,
    order: 1,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "open-diagram",
        label: "$dms_database.diagram.title",
        icon: "i-ph-graph",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: DATABASE_PATHS.diagram },
      },
    ],
  }),
) {
  static tables = tables;
}
