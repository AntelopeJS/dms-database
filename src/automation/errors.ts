import { HTTPResult } from "@antelopejs/interface-api";
import { isRecord, isString } from "../utils/guards";

function refusalMessage(refusal: HTTPResult): string {
  const body = refusal.getBody();
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isString(parsed.message)) return parsed.message;
    if (isString(parsed)) return parsed;
  } catch {
    if (body) return body;
  }
  return body || `Refused with status ${refusal.getStatus()}`;
}

/**
 * Runs a step's work, rethrowing a service's refusal as an `Error` with the
 * refusal's message, which a run records as is.
 *
 * @param work The step's work
 * @returns What the work resolved with
 */
export async function asStep<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HTTPResult) throw new Error(refusalMessage(error));
    throw error;
  }
}
