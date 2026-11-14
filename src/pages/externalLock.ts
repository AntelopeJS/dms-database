import type { ComponentFilterContext } from "@antelopejs/interface-dms/component";
import type { PageHeaderButton } from "@antelopejs/interface-dms/base/layouts";
import { browsesExternal } from "../service/connectionState";

/** The sidebar's lock: its icon and the reason of its tooltip. */
const LOCK_ICON = "i-ph-lock";
const LOCK_REASON = "$dms_database.connections.locked.reason";

function onExternal({ user }: ComponentFilterContext): Promise<boolean> {
  return user ? browsesExternal(user._id) : Promise.resolve(false);
}

/**
 * A header link to a page an external database cannot serve, as two buttons
 * of which one is served: the link itself on the project's own database, and
 * on an external one the same button locked, with the sidebar's lock icon and
 * reason.
 *
 * @param button The link, named by its `id`
 * @returns The link and its locked twin
 */
export function lockedOnExternal(
  button: PageHeaderButton & { id: string },
): [PageHeaderButton, PageHeaderButton] {
  return [
    {
      ...button,
      availability: async (context) =>
        (await onExternal(context)) ? { hidden: true } : undefined,
    },
    {
      ...button,
      id: `${button.id}-locked`,
      icon: LOCK_ICON,
      availability: async (context) =>
        (await onExternal(context))
          ? { reason: LOCK_REASON }
          : { hidden: true },
    },
  ];
}

/**
 * Leaves out a display block's links on an external database: each leads to a
 * page it cannot serve.
 *
 * @param _permissions The caller's permissions, unread
 * @param options The block's served options
 * @param _permissionId The block's permission id, unread
 * @param context The request
 * @returns The options, without their links on an external database
 */
export async function linksHiddenOnExternal<T extends { actions?: unknown }>(
  _permissions: Set<string>,
  options: T,
  _permissionId: string,
  context: ComponentFilterContext,
): Promise<T> {
  return (await onExternal(context))
    ? { ...options, actions: undefined }
    : options;
}
