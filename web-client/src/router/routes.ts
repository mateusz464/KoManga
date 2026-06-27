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
export function routeToHash(_route: Route): string {
  throw new Error("not implemented yet — see KWC-306");
}

// Parse a URL fragment back into a Route. An empty/unknown fragment falls back
// to the library view so the app always lands somewhere valid.
export function parseHash(_hash: string): Route {
  throw new Error("not implemented yet — see KWC-306");
}
