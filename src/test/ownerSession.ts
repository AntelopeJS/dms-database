import { createHmac } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { SessionModel, UserModel } from "@antelopejs/interface-dms/auth/db";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import type { JsonValue } from "../types/json";

/** An owner signed in to the test DMS: the bearer token its requests send, and how to sign out. */
export interface OwnerSession {
  token: string;
  remove(): Promise<void>;
}

/** Creates an owner and a session, and signs an access token for them with the harness's JWT secret. */
export function createOwnerSession(email: string): Promise<OwnerSession> {
  return createSession(email, true);
}

/** Creates a member who is not the owner, and a session, signed the same way. */
export function createMemberSession(email: string): Promise<OwnerSession> {
  return createSession(email, false);
}

async function createSession(
  email: string,
  owner: boolean,
): Promise<OwnerSession> {
  const users = GetModel(UserModel);
  const sessions = GetModel(SessionModel);
  const now = new Date();
  const authKey = `${email}-key`;
  const [userId] = await users.insert({
    email,
    name: email,
    authKey,
    isValidated: true,
    owner,
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  const [sessionId] = await sessions.insert({
    userId,
    userAgent: "",
    ip: "",
    browser: "Unknown",
    os: "Unknown",
    deviceType: "desktop",
    location: "",
    createdAt: now,
    lastActiveAt: now,
  });
  const encode = (value: JsonValue) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const key = createHmac("sha256", `1:${authKey}:test-jwt-secret`)
    .update(
      JSON.stringify([
        userId,
        "access",
        DEFAULT_TENANT_ID,
        sessionId,
        null,
        iat,
        exp,
      ]),
    )
    .digest("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    id: userId,
    tenantId: DEFAULT_TENANT_ID,
    sessionId,
    purpose: "access",
    iat,
    exp,
    key,
  })}`;
  const signature = createHmac("sha256", "2:test-jwt-secret")
    .update(unsigned)
    .digest("base64url");
  return {
    token: `${unsigned}.${signature}`,
    async remove() {
      await sessions.delete(sessionId);
      await users.delete(userId);
    },
  };
}
