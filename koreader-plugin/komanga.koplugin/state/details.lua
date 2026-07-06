-- Pure, framework-free state behind a manga's details view: metadata + ordered
-- chapter list, last-read position, follow state, and follow/unfollow. Reaches the
-- network only through an injected ApiClient, and follows the same fetch*/apply*
-- split as state/browse.lua.

local Details = {}
Details.__index = Details

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

function Details:fetchManga()
    return self.api:getManga(self.manga_id)
end

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

-- Lets the resume/continue path (which threads only { id }) label an offline
-- download without another lookup.
function Details:chapterNumberFor(chapterId)
    for _, chapter in ipairs(self.chapters or {}) do
        if chapter.id == chapterId then
            return chapter.chapterNumber
        end
    end
    return nil
end

-- --- Last-read position --------------------------------------------------------

function Details:fetchProgress()
    return self.api:getProgress(self.manga_id)
end

-- A 404 is the "never read yet" empty state, NOT an error. Any other error is surfaced.
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
-- library membership.
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

-- Passes the loaded title so the library row is labelled by name; if details
-- haven't loaded, it is omitted and the row falls back to the mangaId.
function Details:fetchFollow(addedAt)
    return self.api:follow(self.manga_id, addedAt, self.manga and self.manga.title)
end

-- Flip only on success, so a failed write is retryable.
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
