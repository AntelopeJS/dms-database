import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";

/** A request context for `url`, as a controller reads it, with no connection. */
export function requestContext(url: string): RequestContext {
  const rawRequest = new IncomingMessage(new Socket());
  return {
    rawRequest,
    rawResponse: new ServerResponse(rawRequest),
    url: new URL(url),
    routeParameters: {},
    response: new HTTPResult(200),
  };
}

/** A request context whose query string carries `query`. */
export function queryContext(query: Record<string, string>): RequestContext {
  return requestContext(`https://example.test/?${new URLSearchParams(query)}`);
}
