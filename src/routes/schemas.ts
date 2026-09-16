import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { listSchemaSummariesWithStats } from "../service/introspect";

@AuthOwnerOnly()
export class DatabaseSchemasController extends Controller(
  "/api/database/schemas",
) {
  @Get("/")
  async list(@AuthRawUser() _user: User) {
    return { schemas: await listSchemaSummariesWithStats() };
  }
}
