local Completion = require("state.completion")

local CompletionSync = {}
CompletionSync.__index = CompletionSync

function CompletionSync.new(opts)
    return setmetatable({
        ui = opts.ui,
        net = opts.net,
        api = opts.api,
        completion = nil,
    }, CompletionSync)
end

function CompletionSync:onReaderReady(doc_settings)
    local ds = doc_settings or (self.ui and self.ui.doc_settings)
    if not ds then
        return
    end
    local chapter_id = ds:readSetting("komanga_chapter_id")
    if chapter_id then
        self.completion = Completion.new(self.api, chapter_id)
    end
end

function CompletionSync:onPageUpdate(readerPage)
    if not self.completion then
        return
    end
    local chapter_id = self.completion:onPageUpdate(readerPage, self.ui.document:getPageCount())
    if not chapter_id then
        return
    end
    local completion = self.completion
    self.net:run(function()
        return completion:complete()
    end, { background = true })
end

return CompletionSync
