-- KoManga plugin configuration (CLAUDE.md §5): the API base URL and tuning knobs
-- in one place rather than scattered through views. These are the DEFAULTS; a
-- user's own values (e.g. their tunnel URL) persist via settings.lua and take
-- precedence at runtime.
local Config = {
    -- Base URL of the KoManga API (the Cloudflare Tunnel origin, RFC §4). Unlike
    -- the web client — served same-origin, so its base is "" — this is a
    -- standalone plugin and needs an absolute URL. The user overrides it for
    -- their own tunnel (settings.lua); this is only a placeholder default.
    api_base_url = "https://komanga.example.com",

    -- Reader prefetch window: how many upcoming pages to fetch ahead of display
    -- (CLAUDE.md §8, KRP-504). Bounded so prefetch never runs away.
    prefetch_window = 2,

    -- Progress-sync debounce: minimum seconds between progress pushes on page
    -- turns (CLAUDE.md §6, KRP-601) so rapid turns don't hammer the API.
    progress_debounce_seconds = 5,
}

return Config
