import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getOverviewHealth } from "../service/health";

@AuthOwnerOnly()
export class DatabaseHealthController extends Controller(
  "/api/database/health",
) {
  @Get("/")
  async health(@AuthRawUser() _user: User) {
    return getOverviewHealth();
  }
}
