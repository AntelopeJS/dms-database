import { randomUUID } from "node:crypto";
import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { createUserInviteToken } from "@antelopejs/interface-dms";
import { RoleModel } from "@antelopejs/interface-dms/db";

/** The ids of the permissions a role holds, with every id its grants sit under, as the DMS roles editor stores them. */
function withAncestors(permissions: string[]): string[] {
  return [
    ...new Set(
      permissions.flatMap((id) => {
        const segments = id.split(".");
        return segments.map((_, index) => segments.slice(0, index + 1).join("."));
      }),
    ),
  ];
}

/** What a journey sends to make a member. */
interface MemberRequest {
  name: string;
  permissions: string[];
  owner?: boolean;
}

/**
 * Trusted backend calls a journey cannot make over HTTP: a member with a role
 * of given permissions. Only the verification playground serves them.
 */
export class VerifyFixtureController extends Controller("/verify-database") {
  @Post("/member")
  async member(@JSONBody() body: MemberRequest) {
    const { name } = body;
    const [roleId] = await GetModel(RoleModel, DEFAULT_TENANT_ID).insert({
      name: `${name} ${randomUUID()}`,
      permissions: withAncestors(body.permissions),
    });
    const email = `${name.toLowerCase()}-${randomUUID()}@verify.local`;
    const { token } = await createUserInviteToken({
      tenantId: DEFAULT_TENANT_ID,
      email,
      language: "en",
      roleIds: roleId === undefined ? [] : [roleId],
      asTenantOwner: body.owner === true,
    });
    return { email, token, roleId };
  }
}
