-- KRP-101 stub: proves the plugin loads on-device and registers a menu entry.
-- The real skeleton/module layout lands in KRP-201/202; keep this trivial.
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
                text = _("KoManga plugin stub loaded (KRP-101)."),
            })
        end,
    }
end

return Komanga
