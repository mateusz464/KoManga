-- KRP-501/502 — Chapter acquisition & page mapping (logic). The pure,
-- framework-free state behind acquiring a chapter for reading via the CBZ +
-- ReaderUI path (CLAUDE.md §5: state/ is pure, busted-testable with no KOReader
-- loaded). It reaches the network only through an injected ApiClient (CLAUDE.md
-- §5/§9 — state never touches socket.http); KRP-502's reader glue (ui/) writes the
-- bytes to disk and hands the file to ReaderUI.
--
-- It owns three jobs (the KRP-501 acceptance criteria):
--   1. Acquire the chapter's `eink` CBZ via ApiClient:downloadChapter — the
--      eink-only path (api/client.lua appends ?profile=eink); never a raw CBZ (§6).
--   2. Track build status (pending | completed | failed): only a completed build is
--      "ready" and exposes the stored-CBZ URL; a failed build is surfaced as an
--      error so the UI can offer retry; a transport/HTTP error acquires nothing.
--   3. Map the API page index ↔ CBZ page index. API page indices are 0-based;
--      KOReader's CBZ reader is 1-based, so the mapping is a fixed ±1 offset.
--
-- Acquisition mirrors the other state modules' split into a pure `fetchDownload`
-- (the blocking API call, returning api/client.lua's (data, err)) and an
-- `applyDownload` (mutates this state); `acquire` the specs drive is their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-502).

local Reader = {}
Reader.__index = Reader

-- api: an ApiClient (or a fake). mangaId/chapterId: the chapter this view acquires.
-- Injected, not global.
function Reader.new(api, mangaId, chapterId)
    return setmetatable({
        api = api,
        manga_id = mangaId,
        chapter_id = chapterId,
        status = nil,
        error = nil,
    }, Reader)
end

-- Pure fetch (safe to run off-thread): POST the eink download, returns (data, err).
function Reader:fetchDownload()
    return self.api:downloadChapter(self.chapter_id, self.manga_id)
end

-- Apply the fetched download record. A transport/HTTP error acquires nothing (no
-- status, error surfaced); a `failed` build is surfaced as an error and stays
-- not-ready; a `pending`/`completed` build clears any prior error.
function Reader:applyDownload(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.status = data.status
    if data.status == "failed" then
        self.error = { kind = "build", status = "failed" }
        return false, self.error
    end
    self.error = nil
    return true
end

function Reader:acquire()
    return self:applyDownload(self:fetchDownload())
end

function Reader:getChapterId()
    return self.chapter_id
end

function Reader:getStatus()
    return self.status
end

-- Only a completed build is ready to open.
function Reader:isReady()
    return self.status == "completed"
end

function Reader:isFailed()
    return self.status == "failed"
end

-- The stored-CBZ URL, but only once the build is completed (nil otherwise). The
-- bytes themselves are fetched by the reader glue (KRP-502), off this state.
function Reader:getCbzUrl()
    if not self:isReady() then
        return nil
    end
    return self.api:cbzUrl(self.chapter_id)
end

function Reader:getError()
    return self.error
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
