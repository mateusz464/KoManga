-- KRP-501/502/606 — Chapter acquisition & page mapping (logic). The pure,
-- framework-free state behind acquiring a chapter for reading via the CBZ +
-- ReaderUI path (CLAUDE.md §5: state/ is pure, busted-testable with no KOReader
-- loaded). It reaches the network only through an injected ApiClient (CLAUDE.md
-- §5/§9 — state never touches socket.http); KRP-502's reader glue (ui/) writes the
-- bytes to disk and hands the file to ReaderUI.
--
-- Acquisition uses the TRANSIENT read path (KRP-606): ApiClient:readChapterCbzToFile
-- hits GET /api/chapter/:id/cbz, where the server builds and serves the chapter's
-- eink CBZ from its session cache WITHOUT persisting a download record — so plain
-- reading never shows up under "Downloaded" (only the explicit POST /download does,
-- ui/reader_menu.lua). It is the eink-only path (never a raw CBZ, §6).
--
-- It owns two jobs:
--   1. Acquire the chapter's eink CBZ. `fetchCbz` is a pure fetch, safe to run
--      off-thread in net.lua's forked sub-process (KRP-305): it streams the bytes
--      to destPath and returns only (path, err) — the file is on disk, nothing
--      large crosses the fork pipe. The UI glue picks destPath and opens the file.
--   2. Map the API page index ↔ CBZ page index. API page indices are 0-based;
--      KOReader's CBZ reader is 1-based, so the mapping is a fixed ±1 offset
--      (KRP-502/602 use it to seek a resumed position and translate progress).

local Reader = {}
Reader.__index = Reader

-- api: an ApiClient (or a fake). mangaId/chapterId: the chapter this view acquires.
-- Injected, not global.
function Reader.new(api, mangaId, chapterId)
    return setmetatable({
        api = api,
        manga_id = mangaId,
        chapter_id = chapterId,
    }, Reader)
end

function Reader:getChapterId()
    return self.chapter_id
end

-- Pure fetch (safe to run off-thread): stream the transient eink CBZ to destPath,
-- returning (destPath, nil) on success or (nil, err). No persisted download.
function Reader:fetchCbz(destPath)
    return self.api:readChapterCbzToFile(self.chapter_id, destPath)
end

-- --- API page index ↔ CBZ page index ------------------------------------------
-- API page indices are 0-based; KOReader's CBZ reader is 1-based.

function Reader.apiPageToCbzPage(apiIndex)
    return apiIndex + 1
end

function Reader.cbzPageToApiPage(cbzPage)
    return cbzPage - 1
end

return Reader
