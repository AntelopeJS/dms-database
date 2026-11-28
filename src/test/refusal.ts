import { type HTTPResult, IsHTTPResult } from "@antelopejs/interface-api";
import type { RefusalSpec } from "../service/refusals";
import { isNumber, isRecord, isString } from "../utils/guards";

/**
 * What a controller refused with: the HTTP status and the message it gave, with the params and the
 * severity of a refusal from the table.
 */
export interface Refusal {
  status: number;
  message: string;
  params?: Record<string, string>;
  severity?: string;
}

/** The refusal of the table a controller answers, as {@link refusal} reads it. */
export function refused(
  { status, key, severity = "error" }: RefusalSpec,
  params: Record<string, string> = {},
): Refusal {
  return { status, message: key, params, severity };
}

function isParams(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

/** The refusal body of a failed query run, parsed. */
export interface QueryFailure {
  message: string;
  durationMs: number;
}

/** The text a refusal carries as its body. */
export function bodyText(error: HTTPResult): string {
  const body: unknown = error.getBody();
  if (!isString(body)) throw new Error("the refusal body is not text");
  return body;
}

/** Reads the body of a failed query run, which travels as JSON text. */
export function queryFailure(error: HTTPResult): QueryFailure {
  const body: unknown = JSON.parse(bodyText(error));
  if (
    !isRecord(body) ||
    !isString(body.message) ||
    !isNumber(body.durationMs)
  ) {
    throw new Error("the refusal body is not a query failure");
  }
  return { message: body.message, durationMs: body.durationMs };
}

/** A refusal whose body travels as JSON: a translation key, its parameters and its severity. */
export interface KeyedRefusal {
  status: number;
  body: unknown;
}

/** Awaits a call that must fail with an HTTP error whose body is JSON, and parses that body. */
export async function keyedRefusal(
  call: Promise<unknown>,
): Promise<KeyedRefusal> {
  const { status, text } = await refusedText(call);
  const body: unknown = JSON.parse(text);
  return { status, body };
}

async function refusedText(
  call: Promise<unknown>,
): Promise<{ status: number; text: string }> {
  try {
    await call;
  } catch (error) {
    if (!IsHTTPResult(error)) throw error;
    return { status: error.getStatus(), text: bodyText(error) };
  }
  throw new Error("the call was expected to be refused");
}

/** Awaits a call that must fail with an HTTP error, and reads that error. */
export async function refusal(call: Promise<unknown>): Promise<Refusal> {
  const { status, text } = await refusedText(call);
  const body: unknown = text.startsWith("{") ? JSON.parse(text) : text;
  if (
    isRecord(body) &&
    isString(body.message) &&
    isParams(body.params) &&
    isString(body.severity)
  ) {
    return {
      status,
      message: body.message,
      params: body.params,
      severity: body.severity,
    };
  }
  return { status, message: text };
}
