-- KRP-602 — Progress sync (reader glue). Wires state/progress.lua (KRP-601) to
-- KOReader's reader events so reading progress syncs to the API device-agnostically
-- (RFC §6): resume at the server's stored position on open, push the position back
-- (debounced) on page turns, and force-sync the last page on close. All KOReader-API
-- coupling (the reader events, GotoPage) is confined here so state/ stays pure
-- (CLAUDE.md §5/§12); every network call goes through net.lua (§5/§11).
--
-- Progress pushes are best-effort BACKGROUND calls (net.lua's silent, no-prompt
-- variant): a page turn must never flash a loading dialog or interrupt reading with a
-- wifi prompt. A skipped/failed sync is harmless — the next due turn (or the
-- close-flush) resyncs — so background errors are ignored here rather than surfaced.
--
-- Driven by the plugin's reader-context event handlers (main.lua): the plugin is a
-- registered ReaderUI module, so PageUpdate / ReaderReady / CloseDocument broadcast
-- to it. Which chapter is open is recovered from the DocSettings sidecar the launcher
-- stashed at open time (komanga_chapter_id / komanga_manga_id — ui/reader_launcher),
-- so sync also works for a downloaded chapter reopened from the file manager.
local Event = require("ui/event")
local Progress = require("state/progress")

local ProgressSync = {}
ProgressSync.__index = ProgressSync

-- opts = { ui, net, api }. Collaborators injected (§9). `ui` is the ReaderUI (used to
-- read the sidecar and seek); `net` the single network path; `api` the REST client.
function ProgressSync.new(opts)
    return setmetatable({
        ui = opts.ui,
        net = opts.net,
        api = opts.api,
        progress = nil, -- a state/progress.lua scoped to the open KoManga chapter
    }, ProgressSync)
end

-- Start syncing for the open document, if it is a KoManga chapter, and resume at the
-- server's stored position. Called on ReaderReady (the reader is up and seekable).
function ProgressSync:onReaderReady(doc_settings)
    local ds = doc_settings or (self.ui and self.ui.doc_settings)
    if not ds then
        return
    end
    local chapter_id = ds:readSetting("komanga_chapter_id")
    local manga_id = ds:readSetting("komanga_manga_id")
    -- Progress is scoped per (manga, chapter); without both this isn't a syncable
    -- KoManga chapter, so leave the reader untouched.
    if not (chapter_id and manga_id) then
        return
    end
    self.progress = Progress.new(self.api, manga_id, chapter_id)
    self:resume()
end

-- Fetch the server's stored progress and, if it belongs to this chapter, seek there.
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

-- A page turn: record the position and sync it (debounced by state/progress). Only a
-- due (leading-edge) turn yields a body to push; coalesced turns return nil.
function ProgressSync:onPageTurn(readerPage)
    if not self.progress then
        return
    end
    self:pushBackground(self.progress:onPageTurn(readerPage))
end

-- Reader close: force-sync the last pending position so resume lands on the true last
-- page regardless of the debounce window.
function ProgressSync:onClose()
    if not self.progress then
        return
    end
    self:pushBackground(self.progress:flush())
end

-- Run a progress PUT as a silent background call. nil body → nothing due, no call.
function ProgressSync:pushBackground(body)
    if not body then
        return
    end
    local progress = self.progress
    self.net:run(function()
        return progress:push(body)
    end, {
        background = true,
        -- Best-effort: ignore the result. A failed background sync is retried on the
        -- next due turn / on close; it never interrupts reading with an error.
    })
end

return ProgressSync
