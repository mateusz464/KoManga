-- Pure state behind the "Download this chapter for offline" action (RFC §5.4): it
-- streams a chapter's transient eink CBZ (readChapterCbzToFile) into the device
-- store's path, then records a device-local index entry with the metadata the
-- offline list + reader need (title / chapterNumber / direction). It must NEVER touch
-- the server download endpoint (POST /download) — the offline feature deliberately no
-- longer relies on a server record. Splits fetch/apply like the other state modules.
--
-- `chapter` = { chapterId, mangaId, title, chapterNumber, direction }.
local Downloads = require("state.downloads")

local DownloadCoordinator = {}
DownloadCoordinator.__index = DownloadCoordinator

-- Pure Lua (no lfs) so the module still imports under busted; specs inject their own.
local function file_size_on_disk(path)
    local f = io.open(path, "rb")
    if not f then
        return nil
    end
    local size = f:seek("end")
    f:close()
    return size
end

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

-- Already-downloaded is a no-op returning the stored path with no network call.
function DownloadCoordinator:fetchCbz(chapter)
    local path = self.downloads:pathFor(chapter.chapterId)
    if self.downloads:has(chapter.chapterId) then
        return path, nil
    end
    return self.api:readChapterCbzToFile(chapter.chapterId, path)
end

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

-- On a fetch failure, records nothing (the transient fetch already removed any
-- partial file).
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
