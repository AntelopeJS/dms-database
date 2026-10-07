import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { ActivityFeedItem } from "@antelopejs/interface-dms/base/activity-feed";
import type { NavCardItem } from "@antelopejs/interface-dms/base/nav-card-grid";
import type { TopListItem } from "@antelopejs/interface-dms/base/top-list-card";
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
    return { items: await listSchemaCards(user) };
  }

  @Get("/largest")
  async largest(@AuthRawUser() _user: User): Promise<ListResult<TopListItem>> {
    return { items: await listLargestTables() };
  }

  @Get("/recent-queries")
  async recentQueries(
    @AuthRawUser() user: User,
  ): Promise<ListResult<ActivityFeedItem>> {
    return { items: await listRecentQueries(user._id) };
  }
}
