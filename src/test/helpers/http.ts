import { isJsonValue, type JsonValue } from "../../types/json";
import type { OwnerSession } from "../ownerSession";

/** The test DMS's backend, served by the harness's `api` module. */
export const BACKEND_ROOT = "http://127.0.0.1:5023";

/** The root of the modules' API routes on {@link BACKEND_ROOT}. */
export const API_ROOT = `${BACKEND_ROOT}/api`;

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
export function call(
  session: OwnerSession | null,
  method: string,
  path: string,
  body?: JsonValue,
): Promise<HttpAnswer> {
  return callBackend(session, method, `/api${path}`, body);
}

/** Calls `path` under the module's own API, `/api/database`, the way {@link call} does. */
export function callDatabase(
  session: OwnerSession | null,
  method: string,
  path: string,
  body?: JsonValue,
): Promise<HttpAnswer> {
  return call(session, method, `/database${path}`, body);
}

/** Calls `path` under {@link BACKEND_ROOT}, such as a page's route under `/dms/pages`, the way {@link call} does. */
export async function callBackend(
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
  const response = await fetch(`${BACKEND_ROOT}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: parsed(text), text };
}
