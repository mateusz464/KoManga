-- Pure state behind acquiring a chapter for reading via the CBZ + ReaderUI path.
-- Acquisition uses the transient read path (readChapterCbzToFile), which builds and
-- serves the eink CBZ WITHOUT persisting a download record — so plain reading never
-- shows up under "Downloaded" (only the explicit POST /download does). It also owns
-- the API↔CBZ page-index mapping.

local Reader = {}
Reader.__index = Reader

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

function Reader:fetchCbz(destPath)
    return self.api:readChapterCbzToFile(self.chapter_id, destPath)
end

-- API page indices are 0-based; KOReader's CBZ reader is 1-based.
function Reader.apiPageToCbzPage(apiIndex)
    return apiIndex + 1
end

function Reader.cbzPageToApiPage(cbzPage)
    return cbzPage - 1
end

return Reader
