import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { resolveSelectedDatabase } from "../service/connectionState";
import { listSchemaSummariesWithStats } from "../service/introspect";

@AuthOwnerOnly()
export class DatabaseSchemasController extends Controller(
  "/api/database/schemas",
) {
  @Get("/")
  async list(@AuthRawUser() user: User) {
    const db = await resolveSelectedDatabase(user._id);
    return { schemas: await listSchemaSummariesWithStats(db) };
  }
}
