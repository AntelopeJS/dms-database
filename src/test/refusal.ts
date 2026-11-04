import { HTTPResult } from "@antelopejs/interface-api";
import { isNumber, isRecord, isString } from "../utils/guards";

/** What a controller refused with: the HTTP status and the message it gave. */
export interface Refusal {
  status: number;
  message: string;
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

/** Awaits a call that must fail with an HTTP error, and reads that error. */
export async function refusal(call: Promise<unknown>): Promise<Refusal> {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof HTTPResult)) throw error;
    return { status: error.getStatus(), message: bodyText(error) };
  }
  throw new Error("the call was expected to be refused");
}
