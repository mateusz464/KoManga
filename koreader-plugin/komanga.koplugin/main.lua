-- Plugin entry point: registers the KoManga main-menu entry and wires the rest.
-- Module layout (CLAUDE.md §5): config.lua (API base + knobs), settings.lua
-- (LuaSettings-backed credential/prefs), and the api/ state/ ui/ namespaces that
-- fill in with their feature tickets. Networking (KRP-3xx) and the real screens
-- (KRP-4xx+) replace the placeholder popup below.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Settings = require("settings")
local _ = require("gettext")

local Komanga = WidgetContainer:extend{
    name = "komanga",
    is_doc_only = false,
}

function Komanga:init()
    self.settings = Settings.open()
    self.ui.menu:registerToMainMenu(self)
end

function Komanga:addToMainMenu(menu_items)
    menu_items.komanga = {
        text = _("KoManga"),
        callback = function()
            UIManager:show(InfoMessage:new{
                text = _("KoManga loaded. Browse, search, and reading land in later tickets."),
            })
        end,
    }
end

return Komanga
