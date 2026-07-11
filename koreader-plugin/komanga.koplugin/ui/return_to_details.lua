local ReturnToDetails = {}
ReturnToDetails.__index = ReturnToDetails

function ReturnToDetails.new(opts)
    return setmetatable({
        ui = opts.ui,
        ui_manager = opts.ui_manager,
        show_details = opts.show_details,
        chapter_id = nil,
        manga_id = nil,
        advancing = false,
    }, ReturnToDetails)
end

function ReturnToDetails:onReaderReady(doc_settings)
    local ds = doc_settings or (self.ui and self.ui.doc_settings)
    self.chapter_id = nil
    self.manga_id = nil
    self.advancing = false
    if ds then
        self.chapter_id = ds:readSetting("komanga_chapter_id")
        self.manga_id = ds:readSetting("komanga_manga_id")
    end
end

function ReturnToDetails:setAdvancing(advancing)
    self.advancing = advancing
end

function ReturnToDetails:onCloseDocument()
    local manga_id = self.manga_id
    local should_return = self.chapter_id and manga_id and not self.advancing
    self.chapter_id = nil
    self.manga_id = nil
    self.advancing = false
    if should_return then
        self.ui_manager:scheduleIn(0, function()
            self.show_details({ id = manga_id })
        end)
    end
end

return ReturnToDetails
