-- Pure state behind the "read without downloading the whole chapter" refinement,
-- owning two concerns: (1) bounded, position-driven prefetch — plan(current) fetches
-- the displayed page plus a window of pages ahead, so the next page is ready on a
-- turn, without fanning out into a request per page; (2) no refetch — a ready/pending
-- page is never re-requested, but a FAILED page IS retryable (unlike a cover, a manga
-- page can't degrade to text). Splits fetch/apply like the other state modules.
--
-- The public API is position-based (1-based page numbers the reader knows);
-- internally a position maps to the page id the API fetches.

local Config = require("config")

local Prefetch = {}
Prefetch.__index = Prefetch

-- page_ids: the chapter's page ids in reading order. opts.window bounds how many
-- pages ahead a pass may fetch; defaults to config.prefetch_window.
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

-- A page is a candidate unless pending/ready. A failed page IS a candidate — pages
-- are retryable (unlike covers).
function Prefetch:needs(id)
    local entry = id ~= nil and self.cache[id] or nil
    return entry == nil or entry.status == "failed"
end

-- The displayed page plus up to `window` pages ahead (clamped, in reading order),
-- skipping any pending/ready. Marks the picked pages pending so a later pass won't
-- re-pick them, and returns their page ids.
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

-- A dead page does NOT fail the whole pass — its entry carries failed=true — so one
-- bad page never blanks the window.
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

-- bytes -> ready, anything else -> failed (a failed page stays retryable via plan).
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

-- nil (not ready) is the reader's "not ready to paint" signal.
function Prefetch:getBytes(pos)
    local entry = self.cache[self:pageId(pos)]
    return entry and entry.bytes or nil
end

return Prefetch
