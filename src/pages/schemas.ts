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
import { addSchemaFilters } from "../service/schemaFilters";

// The row placeholders the table view fills in a page target.
const TABLE_QUERY = "schema={schema}&table={name}";
// A page target replaces the whole query: the Inspect action writes the
// filter bar's state back from the row, which the source route fills in
// (empty values read as unset).
const BAR_QUERY = "scope={_scope}&instance={_instance}&q={_q}&has={_has}";

const tables = TableView.fromSource({
  caption: "$dms_database.schemas.caption",
  fetchUrl: "/api/database/tables/source",
  rowIdKey: "id",
  labelKey: "name",
  capabilities: { search: false, filter: true },
  defaultSort: { field: "elementCount", desc: true },
  pageSize: 50,
  // Grows by pages rather than paging: a new filter of the bar (a hidden
  // filter, which a paged table view does not take back to page 1) then
  // lists from the first page again.
  pagination: "loadMore",
  columns: {
    name: {
      name: "$dms_database.schemas.cols.table",
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.MonoDisplay({ copy: true }),
      sortable: true,
      // The widest column: table names run long (order_items_archive_2025).
      size: 280,
      order: 1,
    },
    schema: {
      name: "$dms_database.schemas.cols.schema",
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.MonoDisplay(),
      sortable: true,
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
        // A drawer target slides up from the bottom: the inspector opens
        // from the right, as on the diagram, through the page's inspector
        // block, which reads the table from the URL.
        label: "$dms_database.schemas.actions.inspect",
        icon: "i-ph-sidebar-simple",
        isDefault: true,
        target: {
          type: "page",
          url: `${DATABASE_PATHS.schemas}?${TABLE_QUERY}&${BAR_QUERY}`,
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
    // Also what the bar's filters matching nothing look like: the table view
    // counts no hidden filter as a filter. The component tells them apart.
    firstRun: {
      title: "$dms_database.schemas.empty.first_title",
      description: "$dms_database.schemas.empty.first_description",
      icon: "i-ph-stack",
      component: CustomComponent("DmsDatabaseSchemasEmptyState"),
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

addSchemaFilters(tables);

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
  // First, so the table stays the page's last block.
  static inspector = CustomComponent("DmsDatabaseTableInspectorHost").meta({
    name: "$dms_database.schemas.inspector.meta",
    icon: "i-ph-sidebar-simple",
    description: "$dms_database.schemas.inspector.meta_description",
  });
  static filterBar = CustomComponent("DmsDatabaseSchemasFilterBar").meta({
    name: "$dms_database.schemas.filters.meta",
    icon: "i-ph-funnel",
    description: "$dms_database.schemas.filters.meta_description",
  });
  static tables = tables;
}
