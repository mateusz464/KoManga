-- KRP-505 — Streaming reader (impl). The pure, framework-free state behind the
-- "read without downloading the whole chapter" refinement (CLAUDE.md §5: state/
-- is pure, busted-testable with no KOReader loaded), satisfying the KRP-504
-- contract. It reaches the network only through an injected ApiClient (CLAUDE.md
-- §5/§9 — state never touches socket.http), and owns the two non-UI concerns this
-- ticket carries:
--
--   1. BOUNDED, POSITION-DRIVEN PREFETCH (CLAUDE.md §8): given the page the reader
--      is displaying, fetch that page plus a bounded window of pages AHEAD of it,
--      so the next page is already fetched on a turn — but never fan out into one
--      request per page. `plan(current)` covers positions [current, current+window]
--      clamped to the chapter, in reading order.
--   2. NO REFETCH: a page already fetched (ready) or in flight (pending) is never
--      re-requested. A FAILED page, unlike a cover (KRP-406), is retryable — a
--      manga page can't degrade to text — so a later pass re-plans it.
--
-- Like the other state modules it splits a pure `fetch` (the blocking API calls,
-- safe to run off the UI thread in net.lua's forked sub-process, KRP-305) from an
-- `apply` (mutates this cache in the parent, since the fork can't mutate across
-- it). The planner and reads stay in the parent too. Page bytes themselves are
-- opaque to this module — decoding + on-panel paint is the reader's job (device).
--
-- The public API is POSITION-based (1-based page numbers, what the reader knows);
-- internally a position maps to the chapter's page id, which is what the API
-- fetches. Wire shape mirrors fetchCover (KRP-406):
--   fetchPage(pageId) -> (bytes, nil) | (nil, err)

local Config = require("config")

local Prefetch = {}
Prefetch.__index = Prefetch

-- api: an ApiClient (or a fake exposing fetchPage). page_ids: the chapter's page
-- ids in reading (display) order. opts.window bounds how many pages AHEAD of the
-- displayed one a pass may fetch (CLAUDE.md §8); defaults to config.prefetch_window.
-- Collaborators injected, not global.
function Prefetch.new(api, page_ids, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        page_ids = page_ids or {},
        window = opts.window or Config.prefetch_window,
        -- pageId -> { status = "pending"|"ready"|"failed", bytes = <string?> }
        cache = {},
    }, Prefetch)
end

-- The page id displayed at 1-based position `pos`, or nil past the chapter's end.
function Prefetch:pageId(pos)
    return self.page_ids[pos]
end

function Prefetch:pageCount()
    return #self.page_ids
end

-- A page is a fetch candidate unless it is already in flight (pending) or fetched
-- (ready). A failed page IS a candidate — pages are retryable (unlike covers).
function Prefetch:needs(id)
    local entry = id ~= nil and self.cache[id] or nil
    return entry == nil or entry.status == "failed"
end

-- Plan the window for the page displayed at `current`: the displayed page plus up
-- to `window` pages ahead, clamped to the chapter, in reading order — skipping any
-- already pending/ready. Marks the picked pages pending so a later pass won't
-- re-pick them, and returns their page ids (what fetch requests). Empty means
-- nothing new to do.
function Prefetch:plan(current)
    local batch = {}
    local last = math.min(current + self.window, self:pageCount())
    for pos = current, last do
        local id = self:pageId(pos)
        if self:needs(id) then
            self.cache[id] = { status = "pending" }
            batch[#batch + 1] = id
        end
    end
    return batch
end

-- Pure fetch (safe to run off-thread): fetch each planned id's bytes and return a
-- per-id result table. A dead page does NOT fail the whole pass — its entry just
-- carries failed=true — so one bad page never blanks the window. Mutates nothing.
function Prefetch:fetch(ids)
    local results = {}
    for _, id in ipairs(ids or {}) do
        local bytes, err = self.api:fetchPage(id)
        if bytes and not err then
            results[id] = { bytes = bytes }
        else
            results[id] = { failed = true }
        end
    end
    return results
end

-- Record a fetched batch into the cache: bytes -> ready, anything else -> failed
-- (a failed page stays retryable via plan). Applied in the parent after the
-- off-thread fetch returns.
function Prefetch:apply(results)
    for id, result in pairs(results or {}) do
        if result.bytes then
            self.cache[id] = { status = "ready", bytes = result.bytes }
        else
            self.cache[id] = { status = "failed" }
        end
    end
end

-- --- Read-only state (position-based) ------------------------------------------

function Prefetch:isReady(pos)
    local entry = self.cache[self:pageId(pos)]
    return entry ~= nil and entry.status == "ready"
end

function Prefetch:isFailed(pos)
    local entry = self.cache[self:pageId(pos)]
    return entry ~= nil and entry.status == "failed"
end

-- The page bytes at `pos`, or nil if not yet ready (pending/failed/untouched). The
-- reader decodes these into a bitmap; a nil here is the "not ready to paint" signal.
function Prefetch:getBytes(pos)
    local entry = self.cache[self:pageId(pos)]
    return entry and entry.bytes or nil
end

return Prefetch
