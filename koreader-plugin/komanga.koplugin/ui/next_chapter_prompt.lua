-- Offers to continue into the next chapter when the user pages forward past the
-- final page of a KoManga chapter (KOM-160). The next chapter is resolved ahead
-- of time — a silent background api:getManga at ReaderReady, cached in
-- state/next_chapter.lua — because the EndOfBook decision (consume vs propagate)
-- must be synchronous. When nothing is resolved (last chapter, fetch failed or
-- still in flight, non-KoManga document), the event propagates and KOReader's
-- default end-of-document handling runs untouched.
local ConfirmBox = require("ui/widget/confirmbox")
local UIManager = require("ui/uimanager")
local NextChapter = require("state/next_chapter")
local Reader = require("state/reader")
local ReaderLauncher = require("ui/reader_launcher")
local T = require("ffi/util").template
local _ = require("gettext")

local NextChapterPrompt = {}
NextChapterPrompt.__index = NextChapterPrompt

-- opts = { ui, net, api, auth?, set_advancing? }; `ui` is the ReaderUI.
function NextChapterPrompt.new(opts)
    return setmetatable({
        ui = opts.ui,
        net = opts.net,
        api = opts.api,
        auth = opts.auth,
        set_advancing = opts.set_advancing,
        manga_id = nil,
        next_chapter = nil, -- state/next_chapter.lua, set only for a KoManga chapter
        prompting = false,
    }, NextChapterPrompt)
end

function NextChapterPrompt:onReaderReady(doc_settings)
    local ds = doc_settings or (self.ui and self.ui.doc_settings)
    if not ds then
        return
    end
    local chapter_id = ds:readSetting("komanga_chapter_id")
    local manga_id = ds:readSetting("komanga_manga_id")
    -- Without both (non-KoManga document, or an older sidecar that saved the
    -- manga id conditionally) there is nothing to resolve — stay inert.
    if not (chapter_id and manga_id) then
        return
    end
    self.manga_id = manga_id
    self:hookEndOfBook()
    local state = NextChapter.new(self.api, manga_id, chapter_id)
    self.next_chapter = state
    -- Background + best-effort: a failed/offline resolution is silent (no error
    -- dialog mid-read); the popup simply won't offer.
    self.net:run(function()
        return state:fetchManga()
    end, {
        background = true,
        on_result = function(data, err)
            state:applyManga(data, err)
        end,
    })
end

-- ReaderStatus sits BEFORE plugin modules in ReaderUI's child list and its
-- onEndOfBook returns nothing, so by the time the plugin's own onEndOfBook runs,
-- KOReader's end-of-document dialog is already up. Shadow this document's
-- ReaderStatus handler instead: a consumed event returns true (stopping
-- propagation), anything else falls through to the original. The instance dies
-- with the document, so no unhook is needed.
function NextChapterPrompt:hookEndOfBook()
    local status = self.ui and self.ui.status
    if not status or status.komanga_next_chapter_hooked then
        return
    end
    status.komanga_next_chapter_hooked = true
    local orig_on_end_of_book = status.onEndOfBook
    status.onEndOfBook = function(status_self, ...)
        if self:onEndOfBook() then
            return true
        end
        return orig_on_end_of_book(status_self, ...)
    end
end

local function chapter_label(chapter)
    if chapter.chapterNumber then
        return T(_("Chapter %1"), tostring(chapter.chapterNumber))
    end
    return chapter.name or chapter.id
end

-- Returns true to consume the event (popup offered, or already up); nil lets it
-- propagate to KOReader's default handling.
function NextChapterPrompt:onEndOfBook()
    if self.prompting then
        return true
    end
    local next_chapter = self.next_chapter and self.next_chapter:getNext()
    if not next_chapter then
        return
    end
    self.prompting = true
    UIManager:show(ConfirmBox:new{
        text = T(_("Chapter finished. Continue to %1?"), chapter_label(next_chapter)),
        ok_text = _("Continue"),
        cancel_text = _("Cancel"),
        ok_callback = function()
            self.prompting = false
            self:openNext(next_chapter)
        end,
        -- Also fired on tap-outside/Back (ConfirmBox:onClose), so paging past the
        -- end again re-offers after any dismissal.
        cancel_callback = function()
            self.prompting = false
        end,
    })
    return true
end

-- Same contract as a details-view open: transient eink CBZ, sidecar with the
-- next chapter's identity, direction from the manga's readingDirection. A failed
-- CBZ fetch surfaces through ReaderLauncher's Retry/InfoMessage handling and the
-- current document stays open.
function NextChapterPrompt:openNext(next_chapter)
    ReaderLauncher.open{
        reader = Reader.new(self.api, self.manga_id, next_chapter.id),
        chapter_id = next_chapter.id,
        manga_id = self.manga_id,
        title = next_chapter.mangaTitle,
        chapter_number = next_chapter.chapterNumber,
        direction = next_chapter.direction,
        net = self.net,
        auth = self.auth,
        on_before_show = function()
            if self.set_advancing then
                self.set_advancing(true)
            end
        end,
    }
end

return NextChapterPrompt
