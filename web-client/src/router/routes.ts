// KWC-305/306 — view routes for the minimal client router (CLAUDE.md §5).
//
// The client has four views (RFC §6): the library/home, source search, a
// manga's details + chapter list, and the reader. A Route is the typed,
// framework-free description of "which view, with what params"; the router
// (router.ts) maps it to and from the URL fragment so navigation never triggers
// a full page reload — only the hash changes.
//
// Serialization is hand-rolled (no `URL`/`URLSearchParams`, per the KWC-102
// spike). It lives here as pure functions so it is unit-testable without a DOM,
// mirroring the api/url.ts split.
//
// Red phase (KWC-305): both functions throw until KWC-306 implements them.

// The four views, each carrying exactly the params that view needs.
export type Route =
  | { readonly name: "library" }
  | {
      readonly name: "search";
      readonly query?: string;
      readonly source?: string;
    }
  | { readonly name: "manga"; readonly mangaId: string }
  | {
      readonly name: "reader";
      readonly mangaId: string;
      readonly chapterId: string;
    };

// Serialize a route to a URL fragment, always `#`-prefixed so navigating to it
// is fragment-only — the browser does not reload (KWC-305 acceptance: no full
// reloads between views). Ids and query values are percent-encoded.
export function routeToHash(route: Route): string {
  switch (route.name) {
    case "library":
      return "#/library";
    case "search":
      return "#/search" + buildSearchQuery(route.query, route.source);
    case "manga":
      return "#/manga/" + encodeURIComponent(route.mangaId);
    case "reader":
      return (
        "#/reader/" +
        encodeURIComponent(route.mangaId) +
        "/" +
        encodeURIComponent(route.chapterId)
      );
  }
}

// Parse a URL fragment back into a Route. An empty/unknown fragment falls back
// to the library view so the app always lands somewhere valid.
export function parseHash(hash: string): Route {
  let raw = hash.charAt(0) === "#" ? hash.slice(1) : hash;

  // Peel off the query string (search params) before splitting the path.
  let queryString = "";
  const qIndex = raw.indexOf("?");
  if (qIndex >= 0) {
    queryString = raw.slice(qIndex + 1);
    raw = raw.slice(0, qIndex);
  }

  if (raw.charAt(0) === "/") raw = raw.slice(1);
  const segments = raw.split("/");
  const name = segments[0];

  switch (name) {
    case "library":
      return { name: "library" };
    case "search": {
      const params = parseQuery(queryString);
      const route: { name: "search"; query?: string; source?: string } = {
        name: "search",
      };
      if (params.q !== undefined) route.query = params.q;
      if (params.source !== undefined) route.source = params.source;
      return route;
    }
    case "manga": {
      const id = segments[1];
      if (!id) return { name: "library" };
      return { name: "manga", mangaId: decodeURIComponent(id) };
    }
    case "reader": {
      const mangaId = segments[1];
      const chapterId = segments[2];
      if (!mangaId || !chapterId) return { name: "library" };
      return {
        name: "reader",
        mangaId: decodeURIComponent(mangaId),
        chapterId: decodeURIComponent(chapterId),
      };
    }
    default:
      return { name: "library" };
  }
}

// Hand-built `?q=…&source=…`, omitting absent params (no `URL`/`URLSearchParams`
// — KWC-102). Both key order and encoding must round-trip through parseQuery.
function buildSearchQuery(query?: string, source?: string): string {
  const parts: string[] = [];
  if (query !== undefined) parts.push("q=" + encodeURIComponent(query));
  if (source !== undefined) parts.push("source=" + encodeURIComponent(source));
  return parts.length ? "?" + parts.join("&") : "";
}

// Hand-rolled query parser: split on `&`, then on the first `=`, decoding both
// sides. Counterpart to buildSearchQuery.
function parseQuery(queryString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!queryString) return result;
  const pairs = queryString.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : "";
    result[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return result;
}
