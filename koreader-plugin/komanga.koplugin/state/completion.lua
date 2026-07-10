local Completion = {}
Completion.__index = Completion

function Completion.new(api, chapterId)
    return setmetatable({
        api = api,
        chapter_id = chapterId,
        fired = false,
    }, Completion)
end

function Completion:onPageUpdate(readerPage, pageCount)
    if self.fired or readerPage < 1 or pageCount < 1 or readerPage ~= pageCount then
        return nil
    end
    self.fired = true
    return self.chapter_id
end

function Completion:complete()
    return self.api:complete(self.chapter_id)
end

return Completion
