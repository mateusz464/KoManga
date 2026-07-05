-- KRP-403/404 — Manga details & chapter list (logic). The pure, framework-free
-- state behind a manga's details view (CLAUDE.md §5: state/ is pure,
-- busted-testable with no KOReader loaded). It reaches the network only through an
-- injected ApiClient (CLAUDE.md §5/§9 — state never touches socket.http).
--
-- It owns four jobs (the KRP-403 acceptance criteria):
--   1. Load details: manga metadata, the chapter list IN ORDER, reading direction.
--   2. Load the last-read position; a "never read yet" 404 is the empty state, NOT
--      an error; expose which chapter is the last-read one.
--   3. Load whether the manga is followed (membership of the library list).
--   4. Follow / unfollow: toggle followed state and call the API; on error leave
--      the state intact so a retry is possible.
--
-- Each job mirrors state/browse.lua's split into a pure `fetch*` (the blocking API
-- call, returning api/client.lua's (data, err)) and an `apply*` (mutates this
-- state). The synchronous load/follow/unfollow methods the specs drive are their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-404).

local Details = {}
Details.__index = Details

-- api: an ApiClient (or a fake). mangaId: the manga this view is for. Injected,
-- not global.
function Details.new(api, mangaId)
    return setmetatable({
        api = api,
        manga_id = mangaId,
        manga = nil,
        chapters = {},
        reading_direction = nil,
        last_read_chapter_id = nil,
        last_read_page = nil,
        followed = false,
        error = nil,
    }, Details)
end

-- A 404 is "no progress yet" (the resume empty state), not a hard error.
local function is_not_found(err)
    return err ~= nil and err.kind == "http" and err.status == 404
end

-- --- Details & chapter list ----------------------------------------------------

-- Pure fetch (safe to run off-thread): returns the ApiClient (data, err).
function Details:fetchManga()
    return self.api:getManga(self.manga_id)
end

-- Apply fetched details. On error the metadata/chapters are left as they were and
-- the error is surfaced via getError(); on success the error is cleared.
function Details:applyManga(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.manga = data.manga
    self.chapters = data.chapters or {}
    self.reading_direction = data.readingDirection
    return true
end

function Details:load()
    return self:applyManga(self:fetchManga())
end

function Details:getMangaId()
    return self.manga_id
end

function Details:getManga()
    return self.manga
end

function Details:getChapters()
    return self.chapters
end

function Details:getReadingDirection()
    return self.reading_direction
end

-- --- Last-read position --------------------------------------------------------

function Details:fetchProgress()
    return self.api:getProgress(self.manga_id)
end

-- Apply fetched progress. A 404 is the "never read yet" empty state — success with
-- no last-read position, NOT an error. Any other error is surfaced.
function Details:applyProgress(data, err)
    if is_not_found(err) then
        self.error = nil
        return true
    end
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.last_read_chapter_id = data.chapterId
    self.last_read_page = data.page
    return true
end

function Details:loadProgress()
    return self:applyProgress(self:fetchProgress())
end

function Details:getLastReadChapterId()
    return self.last_read_chapter_id
end

function Details:getLastReadPage()
    return self.last_read_page
end

-- True only for the chapter the synced progress points at (the resume chapter).
function Details:isLastRead(chapterId)
    return self.last_read_chapter_id ~= nil and chapterId == self.last_read_chapter_id
end

-- --- Follow state --------------------------------------------------------------

function Details:fetchLibrary()
    return self.api:listLibrary()
end

-- The manga endpoint carries no follow flag, so follow state is derived from
-- library membership. On error the existing follow state is left unchanged.
function Details:applyLibrary(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    local followed = false
    for _, entry in ipairs(data) do
        if entry.mangaId == self.manga_id then
            followed = true
            break
        end
    end
    self.followed = followed
    return true
end

function Details:loadFollowState()
    return self:applyLibrary(self:fetchLibrary())
end

function Details:isFollowed()
    return self.followed
end

-- --- Follow / unfollow ---------------------------------------------------------

-- Capture the manga's display title at follow time (API-908/KRP-605) so the library
-- list can label the row by name. The title comes from the loaded manga metadata;
-- if details haven't loaded, it is omitted and the row falls back to the mangaId.
function Details:fetchFollow(addedAt)
    return self.api:follow(self.manga_id, addedAt, self.manga and self.manga.title)
end

-- Flip to followed only on success; on a write error the toggle does not flip so a
-- retry is possible.
function Details:applyFollow(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.followed = true
    return true
end

function Details:follow(addedAt)
    return self:applyFollow(self:fetchFollow(addedAt))
end

function Details:fetchUnfollow()
    return self.api:unfollow(self.manga_id)
end

function Details:applyUnfollow(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.followed = false
    return true
end

function Details:unfollow()
    return self:applyUnfollow(self:fetchUnfollow())
end

-- --- Read-only state -----------------------------------------------------------

function Details:getError()
    return self.error
end

return Details
