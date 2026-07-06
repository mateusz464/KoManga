-- Pure state behind server-side reading-progress sync, scoped to one (manga,
-- chapter) — the open chapter. Two concerns:
--   1. Push on page turn, debounced: at most one push per `debounce` seconds. The
--      first turn in a window pushes (leading edge); further turns are coalesced into
--      the latest position (last-write-wins). flush() force-syncs the last pending
--      position (reader close) so resume lands on the true last page. Pure — the
--      caller runs the returned body through net.lua; push(body) is the api wrapper.
--   2. Resume at the synced position, but only when the stored progress belongs to
--      THIS chapter (re-reading an earlier chapter must not jump); a 404 is the
--      never-read empty state, not an error.
--
-- API progress `page` is 0-based; KOReader's CBZ reader is 1-based (mapped below).

local Config = require("config")

local Progress = {}
Progress.__index = Progress

-- opts = { now = function() -> seconds, debounce = seconds }; now defaults to os.time.
function Progress.new(api, mangaId, chapterId, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        manga_id = mangaId,
        chapter_id = chapterId,
        now = opts.now or os.time,
        debounce = opts.debounce or Config.progress_debounce_seconds,
        last_push_time = nil,
        pending = nil, -- latest coalesced position not yet synced { page = N }
    }, Progress)
end

-- Returns the body to push on a leading-edge turn, or nil when the turn is coalesced.
function Progress:onPageTurn(readerPage)
    local page = readerPage - 1 -- 1-based reader page → 0-based API page index
    local now = self.now()
    local due = self.last_push_time == nil
        or (now - self.last_push_time) >= self.debounce
    if due then
        self.last_push_time = now
        self.pending = nil
        return {
            chapterId = self.chapter_id,
            page = page,
            updatedAt = now,
        }
    end
    -- Within the window: coalesce, keeping only the latest position (last-write-wins).
    self.pending = { page = page }
    return nil
end

-- Force-sync the latest pending position regardless of the window; nil if unchanged.
function Progress:flush()
    if not self.pending then
        return nil
    end
    local now = self.now()
    local body = {
        chapterId = self.chapter_id,
        page = self.pending.page,
        updatedAt = now,
    }
    self.pending = nil
    self.last_push_time = now
    return body
end

function Progress:push(body)
    return self.api:putProgress(self.manga_id, body)
end

function Progress:fetchResume()
    return self.api:getProgress(self.manga_id)
end

-- The 1-based reader page to seek to, or nil when there is nothing to resume: a 404
-- is the never-read empty state (no error); progress for another chapter is ignored.
function Progress:applyResume(data, err)
    if err then
        if err.kind == "http" and err.status == 404 then
            return nil
        end
        return nil, err
    end
    if not data or data.chapterId ~= self.chapter_id then
        return nil
    end
    return data.page + 1 -- 0-based API page → 1-based reader page
end

function Progress:resume()
    return self:applyResume(self:fetchResume())
end

return Progress
