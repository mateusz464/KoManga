-- Plugin entry point: registers the KoManga menu entry, builds the collaborators
-- once, and hands them to the screens as they land.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager = require("ui/uimanager")
local InfoMessage = require("ui/widget/infomessage")
local ErrorText = require("ui/errors")
local Settings = require("settings")
local Auth = require("state/auth")
local Net = require("net")
local ApiClient = require("api/client")
local Browse = require("state/browse")
local Details = require("state/details")
local Covers = require("state/covers")
local Reader = require("state/reader")
local Library = require("state/library")
local Downloads = require("state/downloads")
local Config = require("config")
local CredentialPrompt = require("ui/credential_prompt")
local ServerUrlPrompt = require("ui/server_url_prompt")
local SourceBrowser = require("ui/source_browser")
local MangaDetails = require("ui/manga_details")
local LibraryView = require("ui/library_view")
local ReaderLauncher = require("ui/reader_launcher")
local ReaderMenu = require("ui/reader_menu")
local ProgressSync = require("ui/progress_sync")
local DownloadDelete = require("ui/download_delete")
local _ = require("gettext")

local Komanga = WidgetContainer:extend{
    name = "komanga",
    is_doc_only = false,
}

function Komanga:init()
    self.settings = Settings.open()
    -- on_prompt fires on any 401; the API client reads credentialGetter() per request.
    self.auth = Auth.new{
        settings = self.settings,
        on_prompt = function()
            CredentialPrompt.show(self.auth)
        end,
    }
    self.net = Net.new{}
    self.api = ApiClient.new{
        base_url = self.settings:getApiBaseUrl(),
        get_credential = self.auth:credentialGetter(),
    }
    -- Reader context: the plugin is a registered ReaderUI module, so the page-update/
    -- close events below broadcast to it. Progress sync engages only for a KoManga
    -- chapter (recovered from the DocSettings sidecar on ReaderReady, KRP-602).
    if self.ui and self.ui.document then
        self.progress_sync = ProgressSync.new{
            ui = self.ui,
            net = self.net,
            api = self.api,
        }
    end
    self.ui.menu:registerToMainMenu(self)
end

-- Reader events. Each returns nothing so the event keeps propagating to KOReader's
-- own modules, and is inert (no progress_sync) in the file-manager context.
function Komanga:onReaderReady(doc_settings)
    if self.progress_sync then
        self.progress_sync:onReaderReady(doc_settings)
    end
end

function Komanga:onPageUpdate(page)
    if self.progress_sync then
        self.progress_sync:onPageTurn(page)
    end
end

function Komanga:onCloseDocument()
    if self.progress_sync then
        self.progress_sync:onClose()
    end
end

function Komanga:addToMainMenu(menu_items)
    -- In the reader, offer the in-reader chapter menu instead of Browse. Built only
    -- for a KoManga chapter (nil otherwise) and attached to KOReader's own reader
    -- menu, so opening/closing it never disturbs the reading position (KRP-506).
    if self.ui and self.ui.document then
        local entry = ReaderMenu.build{
            ui = self.ui,
            net = self.net,
            api = self.api,
            auth = self.auth,
            downloads = Downloads.open(),
        }
        if entry then
            menu_items.komanga = entry
        end
        return
    end

    menu_items.komanga = {
        text = _("KoManga"),
        sub_item_table = {
            {
                text = _("Library"),
                callback = function()
                    self:showLibrary()
                end,
            },
            {
                text = _("Browse"),
                callback = function()
                    self:showBrowse()
                end,
            },
            {
                text = _("Set credential"),
                callback = function()
                    CredentialPrompt.show(self.auth)
                end,
            },
            {
                text = _("Set server URL"),
                callback = function()
                    self:showServerUrlPrompt()
                end,
            },
        },
    }
end

-- Rebuild the API client on save: it captured the base URL at construction, so
-- subsequent calls only target the new server once it is rebuilt.
function Komanga:showServerUrlPrompt()
    ServerUrlPrompt.show{
        current = self.settings:getApiBaseUrl(),
        on_save = function(url)
            self.settings:setApiBaseUrl(url)
            self.api = ApiClient.new{
                base_url = url,
                get_credential = self.auth:credentialGetter(),
            }
        end,
    }
end

function Komanga:showLibrary()
    -- One shared index handle, so a deletion mutates the same in-memory index the
    -- Library view renders from.
    local downloads = Downloads.open()
    local library_state = Library.new(self.api, downloads)
    local home
    home = LibraryView:new{
        library = library_state,
        net = self.net,
        auth = self.auth,
        continue_reading = function(entry)
            self:continueReading(library_state, entry)
        end,
        open_download = function(download)
            self:resumeReader(download.mangaId, download.chapterId)
        end,
        delete_download = function(download)
            DownloadDelete.confirm{
                downloads = downloads,
                chapter = download,
                on_deleted = function()
                    home:render()
                end,
            }
        end,
        close_callback = function()
            UIManager:close(home)
        end,
    }
    UIManager:show(home)
    home:start()
end

-- Act on a followed row's "continue" tap. The API usually hands each entry a
-- continue target, so a normal row opens that chapter directly; a caught-up row
-- opens its details; a targetless row (older API) falls back to a progress lookup.
function Komanga:continueReading(library_state, entry)
    local label = Library.continueLabel(entry)
    if label.chapterId then
        self:resumeReader(entry.mangaId, label.chapterId)
        return
    end
    if entry.caughtUp then
        self:showDetails({ id = entry.mangaId })
        return
    end
    self:continueViaProgress(library_state, entry.mangaId)
end

-- Fallback: resolve the last-read position via a progress lookup, then jump into the
-- reader at that chapter — or open details when the manga was never read.
function Komanga:continueViaProgress(library_state, manga_id)
    self.net:run(function()
        return library_state:fetchProgress(manga_id)
    end, {
        text = _("Finding your place…"),
        on_result = function(data, err)
            local target, resolve_err = Library.continueTarget(data, err)
            if resolve_err then
                if resolve_err.kind == "cancelled" then
                    return
                end
                if not self.auth:handleError(resolve_err) then
                    UIManager:show(InfoMessage:new{ text = ErrorText.text(resolve_err) })
                end
                return
            end
            if not target then
                -- Never read yet: open details so the user can start a chapter.
                self:showDetails({ id = manga_id })
                return
            end
            self:resumeReader(target.mangaId, target.chapterId)
        end,
    })
end

-- Reading direction lives in the manga metadata, so load it first (through net) to
-- honour RTL/LTR, then hand off to the reader launcher.
function Komanga:resumeReader(manga_id, chapter_id)
    local details_state = Details.new(self.api, manga_id)
    self.net:run(function()
        return details_state:fetchManga()
    end, {
        text = _("Loading chapter…"),
        on_result = function(data, err)
            details_state:applyManga(data, err)
            if err then
                if err.kind == "cancelled" then
                    return
                end
                if not self.auth:handleError(err) then
                    UIManager:show(InfoMessage:new{ text = ErrorText.text(err) })
                end
                return
            end
            self:openReader(details_state, { id = chapter_id })
        end,
    })
end

function Komanga:showBrowse()
    local browser
    browser = SourceBrowser:new{
        browse = Browse.new(self.api),
        covers = Covers.new(self.api, { window = Config.cover_prefetch_window }),
        net = self.net,
        auth = self.auth,
        show_details = function(manga)
            self:showDetails(manga)
        end,
        close_callback = function()
            UIManager:close(browser)
        end,
    }
    UIManager:show(browser)
    browser:start()
end

function Komanga:showDetails(manga)
    local details_state = Details.new(self.api, manga.id)
    local details
    details = MangaDetails:new{
        details = details_state,
        covers = Covers.new(self.api, { window = Config.cover_prefetch_window }),
        manga_stub = manga,
        net = self.net,
        auth = self.auth,
        open_reader = function(chapter)
            self:openReader(details_state, chapter)
        end,
        close_callback = function()
            UIManager:close(details)
        end,
    }
    UIManager:show(details)
    details:start()
end

-- Title / chapter number / direction are threaded from the loaded details so the
-- in-reader "download for offline" action can label the entry without a network call.
function Komanga:openReader(details_state, chapter)
    local manga = details_state:getManga()
    ReaderLauncher.open{
        reader = Reader.new(self.api, details_state:getMangaId(), chapter.id),
        chapter_id = chapter.id,
        manga_id = details_state:getMangaId(),
        title = manga and manga.title,
        chapter_number = chapter.chapterNumber or details_state:chapterNumberFor(chapter.id),
        direction = details_state:getReadingDirection(),
        net = self.net,
        auth = self.auth,
    }
end

return Komanga
