-- Plugin entry point: registers the KoManga main-menu entry and wires the rest.
-- The internal module layout (api/ state/ ui/, config, settings) lands in KRP-202.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local Komanga = WidgetContainer:extend{
    name = "komanga",
    is_doc_only = false,
}

function Komanga:init()
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
