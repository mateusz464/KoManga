-- The home screen: a Menu driving state/library.lua, with two labelled sections.
-- "Following" loads over the network with its own empty/loading state; "Downloaded"
-- reads the device-local index, so it renders with wifi off and needs no loading
-- state. Tapping a followed manga jumps into the reader via main.lua's injected
-- collaborators; tapping a downloaded chapter opens its local CBZ.
local Menu = require("ui/widget/menu")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local ErrorText = require("ui/errors")
local T = require("ffi/util").template
local _ = require("gettext")

local LibraryView = Menu:extend{
    name = "komanga_library",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    -- Collaborators injected by main.lua:
    library = nil,          -- state/library.lua instance
    net = nil,              -- net.lua wrapper (the single network path)
    auth = nil,             -- state/auth.lua (optional — routes a 401 to the prompt)
    continue_reading = nil, -- function(entry): open a followed manga's continue target
    open_download = nil,    -- function(download): open a completed downloaded chapter
    delete_download = nil,  -- function(download): confirm + delete a downloaded chapter
}

function LibraryView:init()
    self.item_table = {}
    self.paths = {} -- single mode → back arrow disabled (Menu convention)
    self.library_ready = false
    Menu.init(self)
end

-- A 401 routes back to credential entry; a dismissed dialog leaves the panel as-is;
-- any other error is shown in place.
function LibraryView:handleError(err)
    if not err then
        return false
    end
    if err.kind == "cancelled" then
        return true
    end
    if self.auth and self.auth:handleError(err) then
        return true
    end
    UIManager:show(InfoMessage:new{ text = ErrorText.text(err) })
    return true
end

-- Called by main.lua after the widget is shown; only the followed list needs an
-- async load.
function LibraryView:start()
    self:render()
    self:loadLibrary()
end

function LibraryView:loadLibrary()
    self.net:run(function()
        return self.library:fetchLibrary()
    end, {
        text = _("Loading library…"),
        on_result = function(data, err)
            self.library_ready = true
            self.library:applyLibrary(data, err)
            if err then
                self:handleError(err)
            end
            self:render()
        end,
    })
end

-- --- Rendering -----------------------------------------------------------------

-- A non-selectable section heading (no callback → onMenuSelect is a no-op).
local function heading(text)
    return { text = text }
end

function LibraryView:render()
    local item_table = {}

    -- Following ------------------------------------------------------------------
    item_table[#item_table + 1] = heading(_("— Following —"))
    if not self.library_ready then
        item_table[#item_table + 1] = { text = _("Loading…") }
    elseif self.library:isEmpty() then
        item_table[#item_table + 1] = { text = _("Your library is empty.") }
    else
        for _, entry in ipairs(self.library:getEntries()) do
            local label = self.library.continueLabel(entry)
            item_table[#item_table + 1] = {
                text = self.library.entryTitle(entry),
                mandatory = label.text,
                callback = function()
                    if self.continue_reading then
                        self.continue_reading(entry)
                    end
                end,
            }
        end
    end

    -- Downloaded (device-local index) --------------------------------------------
    item_table[#item_table + 1] = heading(_("— Downloaded —"))
    local downloads = self.library:getDownloads()
    if #downloads == 0 then
        item_table[#item_table + 1] = { text = _("No downloaded chapters.") }
    else
        for _, download in ipairs(downloads) do
            item_table[#item_table + 1] = {
                text = self.library.downloadTitle(download),
                mandatory = self.library.downloadNumber(download),
                download = download, -- marks the row as a deletable download (onMenuHold)
                callback = function()
                    if self.open_download then
                        self.open_download(download)
                    end
                end,
            }
        end
    end

    self:switchItemTable(T(_("KoManga — Home")), item_table)
end

-- Keep the menu open on a tap and run the row's action (the default closes the whole
-- menu, which suits a file picker, not this view).
function LibraryView:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

-- Long-press a Downloaded row to delete it. Only download rows carry `download`, so
-- holding a heading or a Following row is a no-op.
function LibraryView:onMenuHold(item)
    if item.download and self.delete_download then
        self.delete_download(item.download)
    end
    return true
end

return LibraryView
