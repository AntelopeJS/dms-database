import { isNumber, isString } from "./guards";

/** The most of a message the console or the log keeps, in characters. */
const MAX_MESSAGE_LENGTH = 2_000;
const CUT_MARK = "…";

/** `scheme://user:password@host`: what stands between `://` and `@`. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi;
/** A password or a token given as a parameter, up to the next separator. */
const SECRET_PARAMETER =
  /(\b(?:password|passwd|pwd|secret|token)=)[^\s&;,"']*/gi;

/**
 * `text` with the credentials a driver's message can carry masked, cut past
 * {@link MAX_MESSAGE_LENGTH}: a connection URL names the account and its
 * password, and a driver repeats the URL it could not open.
 */
export function redactSecrets(text: string): string {
  const redacted = text
    .replace(URL_CREDENTIALS, "$1***@")
    .replace(SECRET_PARAMETER, "$1***");
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}${CUT_MARK}`
    : redacted;
}

/** What the log keeps of a thrown value: never the object, whose fields a driver fills with its options. */
export interface ErrorDescription {
  name: string;
  code?: string;
  message: string;
}

/**
 * The description of a thrown value the server log keeps: its class, the
 * `code` a driver gives it, and its message with secrets masked. A thrown
 * value that is no error is passed as its text.
 */
export function describeError(error: Error | string): ErrorDescription {
  if (isString(error)) return { name: "Error", message: redactSecrets(error) };
  const description: ErrorDescription = {
    name: error.name,
    message: redactSecrets(error.message),
  };
  const code: unknown = "code" in error ? error.code : undefined;
  if (isString(code) || isNumber(code)) description.code = String(code);
  return description;
}
