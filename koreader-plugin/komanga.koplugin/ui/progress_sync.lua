-- Wires state/progress.lua to KOReader's reader events: resume at the server's stored
-- position on open, push the position back (debounced) on page turns, force-sync the
-- last page on close. Progress pushes are best-effort BACKGROUND calls (net.lua's
-- silent, no-prompt variant): a page turn must never flash a loading dialog or a wifi
-- prompt, and a skipped/failed sync is harmless — the next due turn or close-flush
-- resyncs — so background errors are ignored. Which chapter is open is recovered from
-- the DocSettings sidecar, so sync also works for a chapter reopened from the file manager.
local Event = require("ui/event")
local Progress = require("state/progress")

local ProgressSync = {}
ProgressSync.__index = ProgressSync

-- opts = { ui, net, api }; `ui` is the ReaderUI (reads the sidecar and seeks).
function ProgressSync.new(opts)
    return setmetatable({
        ui = opts.ui,
        net = opts.net,
        api = opts.api,
        progress = nil, -- a state/progress.lua scoped to the open KoManga chapter
    }, ProgressSync)
end

-- Called on ReaderReady (the reader is up and seekable).
function ProgressSync:onReaderReady(doc_settings)
    local ds = doc_settings or (self.ui and self.ui.doc_settings)
    if not ds then
        return
    end
    local chapter_id = ds:readSetting("komanga_chapter_id")
    local manga_id = ds:readSetting("komanga_manga_id")
    -- Without both, this isn't a syncable KoManga chapter — leave the reader untouched.
    if not (chapter_id and manga_id) then
        return
    end
    self.progress = Progress.new(self.api, manga_id, chapter_id)
    self:resume()
end

-- Best-effort background: an offline/failed fetch just leaves the local position.
function ProgressSync:resume()
    local progress = self.progress
    self.net:run(function()
        return progress:fetchResume()
    end, {
        background = true,
        on_result = function(data, err)
            local page = progress:applyResume(data, err)
            if page then
                self.ui:handleEvent(Event:new("GotoPage", page))
            end
        end,
    })
end

function ProgressSync:onPageTurn(readerPage)
    if not self.progress then
        return
    end
    self:pushBackground(self.progress:onPageTurn(readerPage))
end

-- Force-sync the last pending position so resume lands on the true last page.
function ProgressSync:onClose()
    if not self.progress then
        return
    end
    self:pushBackground(self.progress:flush())
end

-- nil body → nothing due, no call.
function ProgressSync:pushBackground(body)
    if not body then
        return
    end
    local progress = self.progress
    self.net:run(function()
        return progress:push(body)
    end, {
        background = true, -- best-effort; the result is ignored (retried next turn/close)
    })
end

return ProgressSync
