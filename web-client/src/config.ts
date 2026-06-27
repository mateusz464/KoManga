// Client configuration (CLAUDE.md §5). Small and centralised so the API base and
// tuning knobs live in one place instead of being scattered through the views.

export interface ClientConfig {
  // Base URL for the API. Empty means same-origin — which is how the Kobo reaches
  // it: the Node API serves dist/ same-origin (KWC-202), so there is no CORS and
  // no second origin to configure.
  readonly apiBaseUrl: string;
  // How many upcoming pages the reader prefetches ahead of display (KWC-503).
  // Bounded so prefetch never runs away (CLAUDE.md §8).
  readonly prefetchWindow: number;
}

export const config: ClientConfig = {
  apiBaseUrl: "",
  prefetchWindow: 2,
};
