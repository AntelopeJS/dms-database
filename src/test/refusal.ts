import { HTTPResult } from "@antelopejs/interface-api";

/** What a controller refused with: the HTTP status and the message it gave. */
export interface Refusal {
  status: number;
  message: string;
}

/** Awaits a call that must fail with an HTTP error, and reads that error. */
export async function refusal(call: Promise<unknown>): Promise<Refusal> {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof HTTPResult)) throw error;
    const message: string = error.getBody();
    return { status: error.getStatus(), message };
  }
  throw new Error("the call was expected to be refused");
}
