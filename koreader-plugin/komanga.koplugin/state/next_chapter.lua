-- Pure, framework-free state behind the "continue to the next chapter" popup:
-- resolves the chapter immediately after the one the reader has open, from the
-- ascending-chapterNumber list /api/manga/:id serves. Reaches the network only
-- through the injected ApiClient, with the same fetch*/apply* split as
-- state/details.lua (net.lua runs the fetch in a forked sub-process, so the
-- parent applies the result). Until a successful apply, getNext() is nil — the
-- popup simply has nothing to offer.

local NextChapter = {}
NextChapter.__index = NextChapter

function NextChapter.new(api, mangaId, chapterId)
    return setmetatable({
        api = api,
        manga_id = mangaId,
        chapter_id = chapterId,
        next_chapter = nil,
        error = nil,
    }, NextChapter)
end

function NextChapter:fetchManga()
    return self.api:getManga(self.manga_id)
end

function NextChapter:applyManga(data, err)
    if err then
        self.error = err
        self.next_chapter = nil
        return false, err
    end
    self.error = nil
    self.next_chapter = nil
    local chapters = data.chapters or {}
    for i, chapter in ipairs(chapters) do
        if chapter.id == self.chapter_id then
            local entry = chapters[i + 1]
            if entry then
                self.next_chapter = {
                    id = entry.id,
                    name = entry.name,
                    chapterNumber = entry.chapterNumber,
                    direction = data.readingDirection,
                    mangaTitle = data.manga and data.manga.title,
                }
            end
            break
        end
    end
    return true
end

function NextChapter:getNext()
    return self.next_chapter
end

function NextChapter:getError()
    return self.error
end

return NextChapter
