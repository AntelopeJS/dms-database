import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { ActivityFeedItem } from "@antelopejs/interface-dms/base/activity-feed";
import type { NavCardItem } from "@antelopejs/interface-dms/base/nav-card-grid";
import type { TopListItem } from "@antelopejs/interface-dms/base/top-list-card";
import { resolveSelectedDatabase } from "../service/connectionState";
import { OWN_CONNECTION } from "../service/database";
import {
  listRecentQueries,
  listLargestTables,
  listSchemaCards,
} from "../service/overview";
import type { ListResult } from "../types/responses";

/** The feeds of the overview's blocks, each answering `{ items }`. */
@AuthOwnerOnly()
export class DatabaseOverviewController extends Controller(
  "/api/database/overview",
) {
  @Get("/schemas")
  async schemas(@AuthRawUser() user: User): Promise<ListResult<NavCardItem>> {
    const db = await resolveSelectedDatabase(user._id);
    return { items: await listSchemaCards(db) };
  }

  @Get("/largest")
  async largest(@AuthRawUser() user: User): Promise<ListResult<TopListItem>> {
    const db = await resolveSelectedDatabase(user._id);
    return { items: await listLargestTables(db) };
  }

  /**
   * The user's last query console runs. The console runs on the project's own
   * database only, so an external database has none.
   */
  @Get("/recent-queries")
  async recentQueries(
    @AuthRawUser() user: User,
  ): Promise<ListResult<ActivityFeedItem>> {
    const db = await resolveSelectedDatabase(user._id);
    if (db.connection !== OWN_CONNECTION) return { items: [] };
    return { items: await listRecentQueries(user._id) };
  }
}
