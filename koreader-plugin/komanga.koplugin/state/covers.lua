-- KRP-406 — Cover thumbnails (logic). The pure, framework-free state behind the
-- cover thumbnails shown in the search-results and manga-details lists (CLAUDE.md
-- §5: state/ is pure, busted-testable with no KOReader loaded). It reaches the
-- network only through an injected ApiClient (CLAUDE.md §5/§9 — state never touches
-- socket.http), and it owns the two non-UI concerns this ticket carries:
--
--   1. BOUNDED PREFETCH (CLAUDE.md §8): given a list of rows in display order, only
--      ever fetch a bounded window of covers per pass, and never re-fetch one that
--      is already cached, in-flight, or known-missing — so a long result list can't
--      fan out into one request per row.
--   2. DEGRADE TO TEXT: a cover that fails to fetch is remembered as failed, not
--      retried in a loop and never left "loading"; the UI renders text for it
--      (never a blank or broken row, KRP-406 acceptance).
--
-- Like the other state modules it splits a pure `fetch` (the blocking API calls,
-- safe to run off the UI thread in net.lua's forked sub-process) from an `apply`
-- (mutates this cache in the parent, since the fork can't mutate across it). The
-- planner (`plan`) and reads stay in the parent too. Cover bytes themselves are
-- opaque to this module — decoding into a bitmap is the UI's job (KRP-406, device).

local Covers = {}
Covers.__index = Covers

local DEFAULT_WINDOW = 6

-- api: an ApiClient (or a fake exposing fetchCover). opts.window bounds how many
-- covers a single plan/fetch pass may request (CLAUDE.md §8). Injected, not global.
function Covers.new(api, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        window = opts.window or DEFAULT_WINDOW,
        -- id -> { status = "pending"|"ready"|"failed", bytes = <string?> }
        cache = {},
    }, Covers)
end

-- A cover is "untouched" (a fetch candidate) only when we've never planned it: not
-- pending, not already fetched, not known-missing. This is the dedup gate.
function Covers:needs(id)
    return id ~= nil and self.cache[id] == nil
end

-- Select up to `window` untouched covers from `ids` (display order), mark them
-- pending so a later pass won't re-pick them, and return that bounded batch. The
-- caller fetches exactly the returned ids; an empty result means nothing new to do.
function Covers:plan(ids)
    local batch = {}
    for _, id in ipairs(ids or {}) do
        if #batch >= self.window then
            break
        end
        if self:needs(id) then
            self.cache[id] = { status = "pending" }
            batch[#batch + 1] = id
        end
    end
    return batch
end

-- Pure fetch (safe to run off-thread): fetch each planned id's bytes and return a
-- per-id result table. A single dead cover does NOT fail the whole pass — its entry
-- just carries failed=true — so one missing cover never blanks the others. Returns
-- (results, nil); there is no batch-level error to surface.
function Covers:fetch(ids)
    local results = {}
    for _, id in ipairs(ids or {}) do
        local bytes, err = self.api:fetchCover(id)
        if bytes and not err then
            results[id] = { bytes = bytes }
        else
            results[id] = { failed = true }
        end
    end
    return results
end

-- Record a fetched batch into the cache: bytes -> ready, anything else -> failed
-- (degrade to text). Applied in the parent after the off-thread fetch returns.
function Covers:apply(results)
    for id, result in pairs(results or {}) do
        if result.bytes then
            self.cache[id] = { status = "ready", bytes = result.bytes }
        else
            self.cache[id] = { status = "failed" }
        end
    end
end

-- --- Read-only state -----------------------------------------------------------

function Covers:isReady(id)
    local entry = self.cache[id]
    return entry ~= nil and entry.status == "ready"
end

function Covers:isFailed(id)
    local entry = self.cache[id]
    return entry ~= nil and entry.status == "failed"
end

-- The cover bytes for `id`, or nil if not yet ready (pending/failed/untouched). The
-- UI decodes these into a bitmap; a nil here is the "render text" signal.
function Covers:getBytes(id)
    local entry = self.cache[id]
    return entry and entry.bytes or nil
end

return Covers
