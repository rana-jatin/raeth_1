import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Resolves the absolute origin (scheme + host) of the current request so routes
 * can build absolute og:image / canonical URLs that social crawlers require.
 * Falls back to an empty string (relative URLs) if no request context exists.
 */
export const getRequestOrigin = createServerFn({ method: "GET" }).handler(() => {
  try {
    const req = getRequest();
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("host") ?? url.host;
    if (!host) return "";
    return `${proto}://${host}`;
  } catch {
    return "";
  }
});
