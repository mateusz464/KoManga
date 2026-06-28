-- Plugin entry point: registers the KoManga main-menu entry and wires the rest.
-- Module layout (CLAUDE.md §5): config.lua (API base + knobs), settings.lua
-- (LuaSettings-backed credential/prefs), and the api/ state/ ui/ namespaces that
-- fill in with their feature tickets. Networking (KRP-3xx) and the real screens
-- (KRP-4xx+) replace the placeholder popup below.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Settings = require("settings")
local Auth = require("state/auth")
local Net = require("net")
local CredentialPrompt = require("ui/credential_prompt")
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
    self.ui.menu:registerToMainMenu(self)
end

function Komanga:addToMainMenu(menu_items)
    menu_items.komanga = {
        text = _("KoManga"),
        sub_item_table = {
            {
                text = _("Browse"),
                callback = function()
                    UIManager:show(InfoMessage:new{
                        text = _("KoManga loaded. Browse, search, and reading land in later tickets."),
                    })
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

return Komanga
