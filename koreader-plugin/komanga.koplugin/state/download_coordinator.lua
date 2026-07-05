-- KRP-804 — Download-to-device coordinator (impl). The pure, framework-free state
-- behind the "Download this chapter for offline" action (RFC §5.4): it fetches a
-- chapter's TRANSIENT eink CBZ (ApiClient:readChapterCbzToFile, KRP-606 — GET
-- /api/chapter/:id/cbz, built + session-cached with NO server download record)
-- straight to the device store's path (state/downloads.lua's pathFor, KRP-802), then
-- records the device-local index entry with the metadata the offline list + reader
-- need (title / chapterNumber / direction) so the "Downloaded" list is legible and
-- opens with wifi off. It must NEVER touch the server-side download endpoint
-- (ApiClient:downloadChapter / POST /download) — that path persists a server record
-- the offline feature deliberately no longer relies on (RFC §5.4).
--
-- Network reaches it only through an injected ApiClient, and the clock / file-size
-- collaborators are injected too (CLAUDE.md §5/§9), so busted drives it with no
-- KOReader loaded. The fetch/apply split mirrors the other state modules: net.lua
-- runs `fetchCbz` in a forked sub-process that cannot mutate the parent's index
-- across the fork (KRP-305), so the UI (ui/reader_menu.lua) calls `record` in net's
-- on_result callback (parent side).
--
-- `chapter` = { chapterId, mangaId, title, chapterNumber, direction }.
local Downloads = require("state.downloads")

local DownloadCoordinator = {}
DownloadCoordinator.__index = DownloadCoordinator

-- Runtime default file-size reader: seek to the end of the file. Pure Lua (no
-- KOReader/lfs coupling) so the module still imports clean under busted; specs
-- inject their own over the fake fs.
local function file_size_on_disk(path)
    local f = io.open(path, "rb")
    if not f then
        return nil
    end
    local size = f:seek("end")
    f:close()
    return size
end

-- api: an ApiClient (or a fake). downloads: a state/downloads.lua index.
-- opts = { now?, file_size? } — injected so createdAt/size are deterministic in tests.
function DownloadCoordinator.new(api, downloads, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        downloads = downloads,
        now = opts.now or os.time,
        file_size = opts.file_size or file_size_on_disk,
    }, DownloadCoordinator)
end

-- Pure fetch (fork-safe): stream the transient eink CBZ to the device store path,
-- returning (path, nil) or (nil, err). Already-downloaded is a no-op that returns the
-- stored path with NO network call. Mutates no index — `record` does that parent-side.
function DownloadCoordinator:fetchCbz(chapter)
    local path = self.downloads:pathFor(chapter.chapterId)
    if self.downloads:has(chapter.chapterId) then
        return path, nil
    end
    return self.api:readChapterCbzToFile(chapter.chapterId, path)
end

-- Parent-side apply: record the device-local index entry (idempotent) with the
-- offline-list metadata, returning the stored entry.
function DownloadCoordinator:record(chapter, path)
    self.downloads:add{
        chapterId = chapter.chapterId,
        mangaId = chapter.mangaId,
        title = chapter.title,
        chapterNumber = chapter.chapterNumber,
        direction = chapter.direction,
        fileName = Downloads.fileNameFor(chapter.chapterId),
        size = self.file_size(path),
        createdAt = self.now(),
    }
    return self.downloads:get(chapter.chapterId)
end

-- Tested composition of fetchCbz + record: returns (entry, nil) on success,
-- (nil, err) on a fetch failure (recording NOTHING — the transient fetch already
-- removed any partial file), or the existing entry (a no-op) when the chapter is
-- already downloaded.
function DownloadCoordinator:download(chapter)
    if self.downloads:has(chapter.chapterId) then
        return self.downloads:get(chapter.chapterId), nil
    end
    local path, err = self:fetchCbz(chapter)
    if err then
        return nil, err
    end
    return self:record(chapter, path), nil
end

return DownloadCoordinator
