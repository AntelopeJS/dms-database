import { Logging } from "@antelopejs/interface-core/logging";
import type {
  TableViewOptionsSerialized,
  TableViewTabSerialized,
} from "@antelopejs/interface-dms/base/table-view";
import type {
  ComponentBuilder,
  ComponentFilter,
} from "@antelopejs/interface-dms/component";
import { getRegistry } from "./schemaRegistry";

const SCHEMA_TAB_ICON = "i-ph-stack";

/** One table view tab per registered schema, filtering its tables. */
export function listSchemaTabs(): TableViewTabSerialized[] {
  return Array.from(getRegistry().keys())
    .sort((left, right) => left.localeCompare(right))
    .map((schemaId) => ({
      id: `schema-${schemaId}`,
      label: schemaId,
      icon: SCHEMA_TAB_ICON,
      filter: { accessorKey: "schema", mode: "is", value: schemaId },
    }));
}

type TableViewBuilder = ComponentBuilder<TableViewOptionsSerialized>;

interface UserFilterHolder {
  _userOnFilter?: ComponentFilter<TableViewOptionsSerialized>;
}

/**
 * Extends the per-request filter of a source table view with one tab per
 * registered schema. Schemas are registered by modules at run time, after the
 * page, so the tabs can only be added when a request is served.
 *
 * `ComponentBuilder.onFilter` replaces the filter the factory installed (it
 * resolves the tabs, buttons and row actions the caller may see) instead of
 * composing with it, and `onFilterCallback` reads it back lazily, so the
 * factory's filter is taken from the builder before it is replaced. Should a
 * DMS release rename it, the factory's filter is left in place and the table
 * is served without the schema tabs rather than without its checks.
 */
export function addSchemaTabs(builder: TableViewBuilder): TableViewBuilder {
  // Reaching the factory's filter: see above. The builder type does not
  // expose the field, which takes two assertions.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const factoryFilter = (builder as unknown as UserFilterHolder)._userOnFilter;
  if (typeof factoryFilter !== "function") {
    Logging.Warn(
      "[dms-database] the table view filter could not be extended: the Schemas page is served without schema tabs",
    );
    return builder;
  }
  return builder.onFilter(
    async (permissions, options, permissionId, context) => {
      const served = await factoryFilter(
        permissions,
        options,
        permissionId,
        context,
      );
      return { ...served, tabs: [...(served.tabs ?? []), ...listSchemaTabs()] };
    },
  );
}
