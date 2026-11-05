import "server-only";

import { NextResponse } from "next/server";

/**
 * A route handler that always answers in JSON.
 *
 * Every route here says what went wrong as `{ error }`, and the pages that
 * fetch them read that. Anything a handler didn't expect and so didn't
 * catch came back as Next's bare 500 instead, with no body, which a page
 * waiting on JSON can only report as a parse error. Wrapped in this, the
 * unexpected is logged with the route's name and answered the same way as
 * the rest. The words are the ones the routes already use: the panels put
 * "Couldn't read the file:" in front of them.
 */
export function jsonRoute<A extends unknown[]>(name: string, handler: (...args: A) => Response | Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      const req = args[0];
      const where = req instanceof Request ? ` (${req.method} ${new URL(req.url).pathname})` : "";
      console.error(`stac-x: the ${name} route failed${where}:`, e);
      return NextResponse.json({ error: "the server log has the details." }, { status: 500 });
    }
  };
}
