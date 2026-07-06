-- Pure state behind the library / home view, with three jobs: (1) followed manga —
-- the library list, empty being the empty state not an error; (2) continue reading —
-- resolve a manga's last-read position into a jump target (a 404 is the never-read
-- empty state); (3) downloaded chapters — read the DEVICE-LOCAL download index, NOT
-- GET /api/downloads, so the list renders with wifi off (RFC §5.4).
--
-- The followed list uses the usual fetch/apply split. The Downloaded list is a plain
-- local read (no network/fork), exposed directly. continue-reading RETURNS its target
-- rather than mutating, because it is a per-row lookup whose failure must not clobber
-- the shared list error. A library entry's `title` is denormalised at follow time
-- (API-908), so a row is legible without a per-row getManga fan-out.

local Library = {}
Library.__index = Library

function Library.new(api, downloads)
    return setmetatable({
        api = api,
        downloads = downloads,
        entries = {},
        library_loaded = false,
        error = nil,
    }, Library)
end

-- --- Followed manga ------------------------------------------------------------

function Library:fetchLibrary()
    return self.api:listLibrary()
end

function Library:applyLibrary(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.entries = data
    self.library_loaded = true
    return true
end

function Library:loadLibrary()
    return self:applyLibrary(self:fetchLibrary())
end

function Library:getEntries()
    return self.entries
end

-- The title captured at follow time, falling back to the mangaId when omitted.
function Library.entryTitle(entry)
    if type(entry.title) == "string" and entry.title ~= "" then
        return entry.title
    end
    return entry.mangaId
end

-- Trim only a trailing ".0" (41.0 → "41", 40.5 → "40.5"); no rounding.
function Library.formatChapterNumber(number)
    return (tostring(number):gsub("%.0$", ""))
end

-- The API computes the continue target (nextChapter/caughtUp); the plugin only
-- renders it. Returns the label text and the chapterId to open, nil when there is
-- nothing new (caught up, or an older-API row falling back to a bare Continue).
function Library.continueLabel(entry)
    if entry.caughtUp then
        return { text = "Caught Up", chapterId = nil }
    end
    local next_chapter = entry.nextChapter
    if next_chapter and next_chapter.id then
        return {
            text = "Continue (" .. Library.formatChapterNumber(next_chapter.number) .. ")",
            chapterId = next_chapter.id,
        }
    end
    return { text = "Continue", chapterId = nil }
end

-- True only after a successful load returned zero entries (not before a load, nor
-- while entries or an error are present).
function Library:isEmpty()
    return self.library_loaded and self.error == nil and #self.entries == 0
end

-- --- Continue reading ----------------------------------------------------------

function Library:fetchProgress(mangaId)
    return self.api:getProgress(mangaId)
end

-- Map fetched progress into a jump target { mangaId, chapterId, page }. A 404 is the
-- never-read empty state (nil target, no error); any other error is returned as-is.
function Library.continueTarget(data, err)
    if err then
        if err.kind == "http" and err.status == 404 then
            return nil, nil
        end
        return nil, err
    end
    if not data then
        return nil, nil
    end
    return { mangaId = data.mangaId, chapterId = data.chapterId, page = data.page }, nil
end

-- A per-row lookup: returns (target, err), never touching the shared list error.
function Library:continueReading(mangaId)
    return Library.continueTarget(self:fetchProgress(mangaId))
end

-- --- Downloaded chapters (device-local index) ----------------------------------

-- A pure local read (no network), so the Downloaded list renders with wifi off.
function Library:getDownloads()
    return self.downloads:list()
end

Library.fetchDownloads = Library.getDownloads

-- Captured at download time, falling back to the mangaId when absent.
function Library.downloadTitle(download)
    if type(download.title) == "string" and download.title ~= "" then
        return download.title
    end
    return download.mangaId
end

-- "Ch. 41", or blank when the entry carries no number so the row still shows its title.
function Library.downloadNumber(download)
    if download.chapterNumber == nil then
        return ""
    end
    return "Ch. " .. Library.formatChapterNumber(download.chapterNumber)
end

-- Every indexed entry is a completed on-device CBZ (recorded only after its bytes are
-- persisted), so a device download is always openable.
function Library.isOpenable(download)
    return download.fileName ~= nil
end

function Library:getOpenableDownloads()
    local out = {}
    for _, download in ipairs(self:getDownloads()) do
        if Library.isOpenable(download) then
            out[#out + 1] = download
        end
    end
    return out
end

-- --- Read-only state -----------------------------------------------------------

function Library:getError()
    return self.error
end

return Library
