-- KRP-601/602 — Progress sync (logic). The pure, framework-free state behind
-- device-agnostic, server-side reading-progress sync (CLAUDE.md §5: state/ is pure,
-- busted-testable with no KOReader loaded). It reaches the network only through an
-- injected ApiClient (§5/§9 — state never touches socket.http); KRP-602's reader
-- glue (ui/progress_sync.lua) drives it off KOReader's page-update/close events and
-- runs the blocking PUT/GET off the UI thread through net.lua.
--
-- A Progress instance is scoped to one (manga, chapter) — the chapter the reader
-- currently has open — so it knows which record a page turn belongs to and whether
-- stored progress is for the chapter being opened.
--
-- It owns the two concerns of this ticket (the KRP-601 acceptance criteria):
--
--   1. PUSH ON PAGE TURN, DEBOUNCED (CLAUDE.md §6): at-most-one push per `debounce`
--      seconds (config.progress_debounce_seconds, default 5). The first turn in a
--      window pushes (leading edge); further turns within it are COALESCED into the
--      latest position (last-write-wins), held until the window elapses or the reader
--      closes. flush() force-syncs the last pending position regardless of the window
--      so resume always lands on the true last page. The debounce brain is pure and
--      makes NO network call itself — the caller runs the returned body through
--      net.lua (KRP-305); push(body) is the thin api wrapper the caller uses.
--
--   2. RESUME AT THE SYNCED POSITION: opening the chapter reads the manga's stored
--      progress and yields the reader page to seek to — but only when that progress
--      belongs to THIS chapter (re-reading an earlier chapter must not jump). A
--      "never read" 404 is the empty state (no resume), not an error. Split into a
--      pure fetchResume (the blocking GET, run off-thread in net.lua) and applyResume
--      (the parent-side mapping), like the other state modules.
--
-- Page-index mapping mirrors state/reader.lua and the API port contract: API
-- progress `page` is 0-based within the chapter; KOReader's CBZ reader is 1-based.
-- So reader page N syncs as page N-1, and a stored page K resumes at reader page K+1.

local Config = require("config")

local Progress = {}
Progress.__index = Progress

-- api: an ApiClient (or a fake). mangaId/chapterId: the open chapter this instance
-- syncs. opts = { now = function() -> seconds, debounce = seconds }. Collaborators
-- injected, not global (§9); `now` defaults to os.time so state/ stays KOReader-free.
function Progress.new(api, mangaId, chapterId, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        manga_id = mangaId,
        chapter_id = chapterId,
        now = opts.now or os.time,
        debounce = opts.debounce or Config.progress_debounce_seconds,
        last_push_time = nil, -- when the last leading-edge push was decided
        pending = nil,        -- latest coalesced position not yet synced { page = N }
    }, Progress)
end

-- Decide what to sync for a page turn. Returns the body to push on a leading-edge
-- turn (first of a window), or nil when the turn is coalesced into the window. Pure:
-- makes no network call — the caller runs push(body) off-thread through net.lua.
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

-- Force-sync the latest pending position regardless of the debounce window (the
-- reader-close event), so resume always lands on the true last page. Returns the
-- body to push, or nil when nothing changed since the last push.
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

-- Run the actual PUT through the api boundary (§5). The caller wraps this in net.lua
-- so the blocking call runs off the UI thread; returns the client's (data, err).
function Progress:push(body)
    return self.api:putProgress(self.manga_id, body)
end

-- Pure fetch (safe to run off-thread): GET the manga's stored progress, (data, err).
function Progress:fetchResume()
    return self.api:getProgress(self.manga_id)
end

-- Map a fetched progress record to the reader page to seek to (parent-side, no
-- network). Returns the 1-based reader page, or nil when there is nothing to resume:
-- a never-read 404 is the empty state (nil, no error); a non-404 error is surfaced;
-- progress for a different chapter is ignored (nil).
function Progress:applyResume(data, err)
    if err then
        if err.kind == "http" and err.status == 404 then
            return nil -- never read yet — empty state, not an error
        end
        return nil, err
    end
    if not data or data.chapterId ~= self.chapter_id then
        return nil -- stored progress is for another chapter — don't jump
    end
    return data.page + 1 -- 0-based API page → 1-based reader page
end

-- Resume target for opening this chapter: (readerPage, err). Composition of the
-- fetch + apply split the specs drive together.
function Progress:resume()
    return self:applyResume(self:fetchResume())
end

return Progress
