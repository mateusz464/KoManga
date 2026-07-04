-- Plugin entry point: registers the KoManga main-menu entry and wires the rest.
-- Module layout (CLAUDE.md §5): config.lua (API base + knobs), settings.lua
-- (LuaSettings-backed credential/prefs), api/ (the HTTP client), state/ (pure
-- logic), ui/ (KOReader widgets), and net.lua (the single network path). This
-- builds the collaborators once and hands them to the screens as they land.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager = require("ui/uimanager")
local Settings = require("settings")
local Auth = require("state/auth")
local Net = require("net")
local ApiClient = require("api/client")
local Browse = require("state/browse")
local Details = require("state/details")
local Covers = require("state/covers")
local Reader = require("state/reader")
local Config = require("config")
local CredentialPrompt = require("ui/credential_prompt")
local SourceBrowser = require("ui/source_browser")
local MangaDetails = require("ui/manga_details")
local ReaderLauncher = require("ui/reader_launcher")
local ReaderMenu = require("ui/reader_menu")
local ProgressSync = require("ui/progress_sync")
local _ = require("gettext")

local Komanga = WidgetContainer:extend{
    name = "komanga",
    is_doc_only = false,
}

function Komanga:init()
    self.settings = Settings.open()
    -- 401 from any call routes back to credential entry (KRP-303/304); the API
    -- client (KRP-302) reads auth:credentialGetter() per request.
    self.auth = Auth.new{
        settings = self.settings,
        on_prompt = function()
            CredentialPrompt.show(self.auth)
        end,
    }
    -- The single path views use for network calls (KRP-305): wifi-gated +
    -- non-blocking. Built once here and handed to screens as they land.
    self.net = Net.new{}
    -- The only place HTTP lives (KRP-302): reads the credential per request and
    -- targets the user's configured API base.
    self.api = ApiClient.new{
        base_url = self.settings:getApiBaseUrl(),
        get_credential = self.auth:credentialGetter(),
    }
    -- Reader context (a document is open): sync reading progress to the API off the
    -- reader's page-update/close events (KRP-602). The plugin is a registered ReaderUI
    -- module, so those events broadcast to the handlers below; the sync only engages
    -- for a KoManga chapter (recovered from the DocSettings sidecar on ReaderReady).
    if self.ui and self.ui.document then
        self.progress_sync = ProgressSync.new{
            ui = self.ui,
            net = self.net,
            api = self.api,
        }
    end
    self.ui.menu:registerToMainMenu(self)
end

-- Reader events (broadcast to the plugin as a registered ReaderUI module). Each
-- delegates to the progress sync and returns nothing, so the event keeps propagating
-- to KOReader's own modules. Guarded so they are inert in the file-manager context.
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
    -- Reader context (a document is open): offer the in-reader chapter menu instead
    -- of Browse. The same plugin loads in both the file manager and the reader
    -- (is_doc_only = false); self.ui is the ReaderUI here and carries the open
    -- document. The menu is built only for a KoManga chapter (nil otherwise), and
    -- attached to KOReader's own reader menu so opening/closing it never disturbs the
    -- reading position (KRP-506).
    if self.ui and self.ui.document then
        local entry = ReaderMenu.build{
            ui = self.ui,
            net = self.net,
            api = self.api,
            auth = self.auth,
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
        },
    }
end

-- Open the source list & search screen (KRP-402). A fresh Browse per visit so each
-- session starts clean; the screen drives it through net (wifi-gated, non-blocking)
-- and the initial source load is kicked once the widget is on screen.
function Komanga:showBrowse()
    local browser
    browser = SourceBrowser:new{
        browse = Browse.new(self.api),
        -- A fresh cover cache per visit (CLAUDE.md §8: bounded prefetch); the window
        -- comes from config so it's tunable in one place (KRP-406).
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

-- Open the manga details & chapter-list screen (KRP-404) for a search-result row. A
-- fresh Details per visit; the screen drives it through net (wifi-gated,
-- non-blocking) and kicks the loads once the widget is on screen.
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

-- Open a chapter in KOReader's native reader (KRP-502). A fresh Reader per chapter;
-- the launcher drives it through net (wifi-gated, non-blocking) and honours the
-- manga's reading direction (RTL/LTR) from the loaded details.
function Komanga:openReader(details_state, chapter)
    ReaderLauncher.open{
        reader = Reader.new(self.api, details_state:getMangaId(), chapter.id),
        chapter_id = chapter.id,
        manga_id = details_state:getMangaId(),
        rtl = details_state:getReadingDirection() == "rtl",
        net = self.net,
        api = self.api,
        auth = self.auth,
    }
end

return Komanga
