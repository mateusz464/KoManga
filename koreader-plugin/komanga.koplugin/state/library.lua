-- KRP-603/604 — Library / home view (logic). The pure, framework-free state
-- behind the library / home view (CLAUDE.md §5: state/ is pure, busted-testable
-- with no KOReader loaded). It reaches the network only through an injected
-- ApiClient (CLAUDE.md §5/§9 — state never touches socket.http).
--
-- It owns three jobs (the KRP-603 acceptance criteria):
--   1. Followed manga: load the library list in the API's added_at ASC order; an
--      empty library is the empty state, NOT an error.
--   2. Continue reading: resolve a followed manga's last-read position into a jump
--      target the reader can open. A "never read yet" 404 is the empty state (no
--      target), NOT an error.
--   3. Downloaded chapters: read the DEVICE-LOCAL download index (state/downloads.lua,
--      KRP-802) — NOT GET /api/downloads — so the list renders with wifi off (RFC
--      §5.4). Every indexed entry is a completed on-device CBZ, so all are openable;
--      each carries the manga title + chapter number captured at download time, so a
--      row is legible without a network lookup (resolves the KRP-605 raw-id note).
--
-- The followed list mirrors state/browse.lua's split into a pure `fetchLibrary` (the
-- blocking API call, returning api/client.lua's (data, err)) and an `applyLibrary`
-- (that mutates this state); the synchronous `loadLibrary` the specs drive is their
-- composition, and the UI (KRP-604) keeps them apart, running the fetch through
-- net.lua (off the UI thread, in a forked sub-process) and applying the result here
-- in the parent, since a sub-process can't mutate this table across the fork
-- (KRP-305). The Downloaded list needs none of this: it is a local read of the
-- device index (no network, no fork), so it is exposed directly rather than through a
-- fetch/apply split. The continue-reading resolver RETURNS its target instead of
-- mutating (like state/progress.lua's applyResume) because it is a per-manga,
-- per-row lookup, not shared list state — so a failed lookup never clobbers the
-- shared list error.
--
-- NOTE: each library entry carries a display `title` captured at follow time
-- (API-908), alongside its mangaId reference. The title is optional — a row
-- followed before API-908 (or by a title-less client) omits it — so `entryTitle`
-- falls back to the mangaId. This is the denormalised title on the library entry,
-- not a per-row getManga fan-out (CLAUDE.md §6/§8/§10).

local Library = {}
Library.__index = Library

-- api: an ApiClient (or a fake exposing listLibrary/getProgress). downloads: a
-- state/downloads.lua device-local index (or a fake exposing list()). Both injected,
-- not global. The Downloaded section reads `downloads`; nothing else needs it.
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

-- Pure fetch (safe to run off-thread): returns the ApiClient (data, err).
function Library:fetchLibrary()
    return self.api:listLibrary()
end

-- Apply a fetched library list. On error, prior entries are kept and the error is
-- surfaced via getError(); on success the list is replaced and the error cleared.
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

-- A followed row's display label: the title captured at follow time (API-908),
-- falling back to the mangaId when the API omits it (a pre-title library row).
function Library.entryTitle(entry)
    if type(entry.title) == "string" and entry.title ~= "" then
        return entry.title
    end
    return entry.mangaId
end

-- Render a decimal chapter number exactly — trimming only a trailing ".0"
-- (41.0 → "41", 40.5 → "40.5"); no rounding. LuaJIT prints an integral float
-- without a fraction already; the gsub also covers a Lua 5.3 "41.0".
function Library.formatChapterNumber(number)
    return (tostring(number):gsub("%.0$", ""))
end

-- KRP-607 — a followed row's "continue" mandatory: which chapter to read next.
-- The API (API-912) computes the continue target and hands each entry a
-- `nextChapter { id, number }` (nil when caught up or unknown) plus a `caughtUp`
-- flag; the plugin only renders it — it cannot compute the target without a per-row
-- progress + chapter-list fan-out (CLAUDE.md §6/§8). Returns the mandatory text and
-- the chapterId to open, which is nil when there is nothing new to open (a caught-up
-- row, or an older-API / no-stored-chapters row that falls back to a bare Continue).
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

-- True only after a successful load returned zero entries (the empty state). False
-- before any load, when entries are present, and when an error is outstanding.
function Library:isEmpty()
    return self.library_loaded and self.error == nil and #self.entries == 0
end

-- --- Continue reading ----------------------------------------------------------

-- Pure fetch of a manga's stored progress (safe to run off-thread).
function Library:fetchProgress(mangaId)
    return self.api:getProgress(mangaId)
end

-- Pure resolver: map fetched progress into a jump target the reader can open —
-- { mangaId, chapterId, page }. A never-read 404 is the empty state (nil target, no
-- error); any other error is returned as-is. The reader/progress-sync (KRP-602)
-- seeks the actual page on open, so the target only needs the chapter to open; the
-- raw page is carried for the "last-read render".
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

-- Resolve a followed manga's last-read position into a jump target. A per-row
-- lookup: it returns (target, err) and never touches the shared list error.
function Library:continueReading(mangaId)
    return Library.continueTarget(self:fetchProgress(mangaId))
end

-- --- Downloaded chapters (device-local index, KRP-805) -------------------------

-- The device index entries, in insertion order. A pure local read (no network), so
-- the Downloaded list renders with wifi off (RFC §5.4). The store is loaded into
-- memory at construction, so this never blocks and never errors like an API call.
function Library:getDownloads()
    return self.downloads:list()
end

-- Retained name for the read; identical to getDownloads now that the source is the
-- on-device index rather than GET /api/downloads.
Library.fetchDownloads = Library.getDownloads

-- A downloaded row's display title: captured at download time (KRP-803), falling
-- back to the mangaId when absent (mirrors entryTitle for a followed row).
function Library.downloadTitle(download)
    if type(download.title) == "string" and download.title ~= "" then
        return download.title
    end
    return download.mangaId
end

-- The chapter-number label for a downloaded row (e.g. "Ch. 41"); blank when the
-- entry carries no number, so the row still renders its title.
function Library.downloadNumber(download)
    if download.chapterNumber == nil then
        return ""
    end
    return "Ch. " .. Library.formatChapterNumber(download.chapterNumber)
end

-- Every indexed entry is a completed on-device CBZ — the coordinator records it only
-- after the bytes are persisted (KRP-803) — so a device download is always openable.
function Library.isOpenable(download)
    return download.fileName ~= nil
end

-- The downloads that can actually be opened, in index order (all of them, offline).
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
