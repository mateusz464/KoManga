-- Pure state behind the cover thumbnails in the results/details lists, owning two
-- concerns: (1) bounded prefetch — only fetch a window of covers per pass and never
-- re-fetch one already cached/in-flight/known-missing, so a long list can't fan out
-- into a request per row; (2) degrade to text — a failed cover is remembered failed,
-- not retried in a loop, and the UI renders text for it. Splits fetch/apply like the
-- other state modules; cover bytes are opaque here (the UI decodes them).

local Covers = {}
Covers.__index = Covers

local DEFAULT_WINDOW = 6

-- opts.window bounds how many covers a single plan/fetch pass may request.
function Covers.new(api, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        window = opts.window or DEFAULT_WINDOW,
        -- id -> { status = "pending"|"ready"|"failed", bytes = <string?> }
        cache = {},
    }, Covers)
end

-- The dedup gate: a cover is a fetch candidate only when never planned before.
function Covers:needs(id)
    return id ~= nil and self.cache[id] == nil
end

-- Select up to `window` untouched covers (display order) and mark them pending so a
-- later pass won't re-pick them. The caller fetches exactly the returned ids.
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

-- A single dead cover does NOT fail the whole pass — its entry carries failed=true —
-- so one missing cover never blanks the others.
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

-- bytes -> ready, anything else -> failed (degrade to text).
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

-- nil (not ready) is the UI's "render text" signal.
function Covers:getBytes(id)
    local entry = self.cache[id]
    return entry and entry.bytes or nil
end

return Covers
