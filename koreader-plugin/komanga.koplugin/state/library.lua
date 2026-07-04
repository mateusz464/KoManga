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
--   3. Downloaded chapters: load the downloads list and expose which are OPENABLE
--      — only a `completed` build can be opened; `pending`/`failed` rows are not.
--
-- Each list-load mirrors state/browse.lua's split into a pure `fetch*` (the
-- blocking API call, returning api/client.lua's (data, err)) and an `apply*` (that
-- mutates this state). The synchronous `loadLibrary`/`loadDownloads` the specs
-- drive are their composition; the UI (KRP-604) keeps them apart, running the fetch
-- through net.lua (off the UI thread, in a forked sub-process) and applying the
-- result here in the parent, since a sub-process can't mutate this table across the
-- fork (KRP-305). The continue-reading resolver RETURNS its target instead of
-- mutating (like state/progress.lua's applyResume) because it is a per-manga,
-- per-row lookup, not shared list state — so a failed lookup never clobbers the
-- shared list error.
--
-- NOTE: library entries carry only a mangaId reference (no title) — the API has no
-- richer library/metadata endpoint yet (RFC §14). Joining an entry to a title is
-- therefore out of scope here and would be an API-epic ticket (CLAUDE.md §6/§10),
-- not a plugin-side per-row getManga fan-out (§8).

local Library = {}
Library.__index = Library

-- api: an ApiClient (or a fake exposing listLibrary/getProgress/listDownloads).
-- Injected, not global.
function Library.new(api)
    return setmetatable({
        api = api,
        entries = {},
        downloads = {},
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

-- --- Downloaded chapters -------------------------------------------------------

-- Pure fetch (safe to run off-thread): returns the ApiClient (data, err).
function Library:fetchDownloads()
    return self.api:listDownloads()
end

-- Apply a fetched downloads list. On error, prior downloads are kept and the error
-- is surfaced; on success the list is replaced and the error cleared.
function Library:applyDownloads(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.downloads = data
    return true
end

function Library:loadDownloads()
    return self:applyDownloads(self:fetchDownloads())
end

function Library:getDownloads()
    return self.downloads
end

-- Only a `completed` build can be opened; a `pending`/`failed` row is not.
function Library.isOpenable(download)
    return download.status == "completed"
end

-- The downloads that can actually be opened, in the API's serve order.
function Library:getOpenableDownloads()
    local out = {}
    for _, download in ipairs(self.downloads) do
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
