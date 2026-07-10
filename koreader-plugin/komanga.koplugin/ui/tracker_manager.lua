local InfoMessage = require("ui/widget/infomessage")
local Menu = require("ui/widget/menu")
local UIManager = require("ui/uimanager")
local ErrorText = require("ui/errors")
local Library = require("state/library")
local TrackerMatch = require("state/tracker_match")
local _ = require("gettext")

local TrackerManager = Menu:extend{
    name = "komanga_tracker_manager",
    is_borderless = true,
    is_popout = false,
    title = _("Tracking"),
    library = nil,
    api = nil,
    net = nil,
    auth = nil,
    manage = nil,
}

function TrackerManager:init()
    self.item_table = {}
    self.paths = {}
    self.loaded = false
    self.matches = {}
    Menu.init(self)
end

function TrackerManager:start()
    self:render()
    self:loadLibrary()
end

function TrackerManager:handleError(err)
    if not err or err.kind == "cancelled" then
        return
    end
    if self.auth and self.auth:handleError(err) then
        return
    end
    UIManager:show(InfoMessage:new{ text = ErrorText.text(err) })
end

function TrackerManager:loadLibrary()
    self.loaded = false
    self:render()
    self.net:run(function()
        return self.library:fetchLibrary()
    end, {
        text = _("Loading tracking manager…"),
        on_result = function(data, err)
            self.loaded = true
            if not self.library:applyLibrary(data, err) then
                self:handleError(err)
                self:render()
                return
            end
            self.matches = {}
            for _, entry in ipairs(self.library:getEntries()) do
                self.matches[entry.mangaId] = TrackerMatch.new(self.api, entry.mangaId)
            end
            self:render()
            self:loadStatus(1)
        end,
    })
end

function TrackerManager:loadStatus(index)
    local entries = self.library:getEntries()
    local entry = entries[index]
    if not entry then
        return
    end
    local match = self.matches[entry.mangaId]
    self.net:run(function()
        return match:fetchStatus()
    end, {
        text = _("Checking AniList tracking…"),
        on_result = function(data, err)
            match:applyStatus(data, err)
            self:handleError(err)
            self:render()
            self:loadStatus(index + 1)
        end,
    })
end

function TrackerManager:retryStatus(entry)
    local match = self.matches[entry.mangaId]
    self.net:run(function()
        return match:fetchStatus()
    end, {
        text = _("Checking AniList tracking…"),
        on_result = function(data, err)
            match:applyStatus(data, err)
            self:handleError(err)
            self:render()
        end,
    })
end

function TrackerManager:render()
    local rows = {}
    if not self.loaded then
        rows[#rows + 1] = { text = _("Loading…") }
    elseif self.library:getError() then
        rows[#rows + 1] = {
            text = ErrorText.text(self.library:getError()),
            mandatory = _("Tap to retry"),
            callback = function() self:loadLibrary() end,
        }
    elseif self.library:isEmpty() then
        rows[#rows + 1] = { text = _("Your library is empty.") }
        rows[#rows + 1] = { text = _("Add manga to the library to manage tracking here.") }
    else
        for _, entry in ipairs(self.library:getEntries()) do
            local match = self.matches[entry.mangaId]
            local status = match and match:statusLine()
            local row = { text = Library.entryTitle(entry) }
            if not match or (not match:getState() and not match:getError()) then
                row.mandatory = _("Loading…")
            elseif match:getError() then
                row.mandatory = _("Error — tap to retry")
                row.callback = function() self:retryStatus(entry) end
            else
                row.mandatory = status or _("Tracking unavailable")
                row.callback = function()
                    if self.manage then
                        self.manage(entry, match, function() self:render() end)
                    end
                end
            end
            rows[#rows + 1] = row
        end
    end
    self:switchItemTable(_("KoManga — Tracking"), rows)
end

function TrackerManager:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

return TrackerManager
