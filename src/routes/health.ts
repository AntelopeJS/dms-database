import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { resolveSelectedDatabase } from "../service/connectionState";
import { getOverviewHealth } from "../service/health";

@AuthOwnerOnly()
export class DatabaseHealthController extends Controller(
  "/api/database/health",
) {
  @Get("/")
  async health(@AuthRawUser() user: User) {
    return getOverviewHealth(await resolveSelectedDatabase(user._id));
  }
}
