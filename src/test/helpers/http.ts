import { isJsonValue, type JsonValue } from "../../types/json";
import type { OwnerSession } from "../ownerSession";

/** The test DMS's API root, served by the harness's `api` module. */
export const API_ROOT = "http://127.0.0.1:5023/api";

/** What the backend answered: its status, its body as JSON (`null` when it is not JSON), and its raw text. */
export interface HttpAnswer {
  readonly status: number;
  readonly body: JsonValue;
  readonly text: string;
}

function parsed(text: string): JsonValue {
  try {
    const value: unknown = JSON.parse(text);
    return isJsonValue(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Calls `path` under {@link API_ROOT} as `session`, or with no session when it is `null`, the way the dashboard
 * does: a bearer token and the default namespace. Never throws on a status.
 */
export async function call(
  session: OwnerSession | null,
  method: string,
  path: string,
  body?: JsonValue,
): Promise<HttpAnswer> {
  const headers = new Headers({
    accept: "application/json",
    "x-antelopejs-namespace": "default",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (session !== null) headers.set("authorization", `Bearer ${session.token}`);
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: parsed(text), text };
}
