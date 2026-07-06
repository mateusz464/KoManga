-- Default config knobs; a user's own values persist via settings.lua and win at runtime.
local Config = {
    -- Placeholder default; the user points this at their own API/tunnel origin.
    api_base_url = "http://192.168.1.251:3000",

    -- Pages fetched ahead of display, and list-row covers fetched per pass. Both
    -- bounded so prefetch never runs away on a long chapter/result list.
    prefetch_window = 2,
    cover_prefetch_window = 6,

    -- Minimum seconds between progress pushes, so rapid page turns don't hammer the API.
    progress_debounce_seconds = 5,
}

return Config
