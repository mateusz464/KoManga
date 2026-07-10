local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local Menu = require("ui/widget/menu")
local UIManager = require("ui/uimanager")
local CoverThumbnail = require("ui/cover_thumbnail")
local ErrorText = require("ui/errors")
local Retry = require("ui/retry")
local _ = require("gettext")

local COVER_W = 64
local COVER_H = 90

local TrackerMatchView = Menu:extend{
    name = "komanga_tracker_match",
    is_borderless = true,
    is_popout = false,
    title = _("Track on AniList"),
    state_w = COVER_W,
    items_max_lines = 3,
    match = nil,
    net = nil,
    auth = nil,
    manga_title = nil,
    on_changed = nil,
}

local function candidate_text(candidate)
    local lines = { candidate.title or candidate.mediaId }
    if type(candidate.alternateTitles) == "table" and #candidate.alternateTitles > 0 then
        lines[#lines + 1] = table.concat(candidate.alternateTitles, " / ")
    end
    local metadata = {}
    if candidate.year then
        metadata[#metadata + 1] = tostring(candidate.year)
    end
    if candidate.format and candidate.format ~= "" then
        metadata[#metadata + 1] = candidate.format
    end
    if #metadata > 0 then
        lines[#lines + 1] = table.concat(metadata, " · ")
    end
    return table.concat(lines, "\n")
end

local function candidate_menu_text(candidate)
    local text = candidate.title or candidate.mediaId
    if type(candidate.alternateTitles) == "table" and #candidate.alternateTitles > 0 then
        text = text .. " — " .. table.concat(candidate.alternateTitles, " / ")
    end
    return text
end

local function candidate_metadata(candidate)
    local metadata = {}
    if candidate.year then
        metadata[#metadata + 1] = tostring(candidate.year)
    end
    if candidate.format and candidate.format ~= "" then
        metadata[#metadata + 1] = candidate.format
    end
    return #metadata > 0 and table.concat(metadata, " · ") or nil
end

function TrackerMatchView:init()
    self.item_table = {}
    self.paths = {}
    self.loaded = false
    Menu.init(self)
end

function TrackerMatchView:start()
    self:render()
    self:loadCandidates()
end

function TrackerMatchView:handleAuth(err)
    return err and self.auth and self.auth:handleError(err)
end

function TrackerMatchView:loadCandidates()
    self.loaded = false
    self:render()
    self.net:run(function()
        return self.match:fetchCandidates()
    end, {
        text = _("Finding AniList matches…"),
        on_result = function(data, err)
            self.loaded = true
            self.match:applyCandidates(data, err)
            self:handleAuth(err)
            self:render()
            if not err then
                self:loadCandidateCover(1)
            end
        end,
    })
end

function TrackerMatchView:loadCandidateCover(index)
    local candidates = self.match:getCandidates()
    if index > #candidates then
        return
    end
    local candidate = candidates[index]
    if type(candidate.coverImageUrl) ~= "string" or candidate.coverImageUrl == "" then
        self:loadCandidateCover(index + 1)
        return
    end
    self.net:run(function()
        return self.match:fetchCandidateCover(index)
    end, {
        background = true,
        on_result = function(bytes, err)
            self.match:applyCandidateCover(index, bytes, err)
            self:render()
            self:loadCandidateCover(index + 1)
        end,
    })
end

function TrackerMatchView:confirmCandidate(index)
    if not self.match:selectCandidate(index) then
        return
    end
    local candidate = self.match:getSelected()
    UIManager:show(ConfirmBox:new{
        text = candidate_text(candidate),
        ok_text = _("Confirm"),
        ok_callback = function()
            self:saveCandidate()
        end,
    })
end

function TrackerMatchView:saveCandidate()
    Retry.run{
        net = self.net,
        auth = self.auth,
        text = _("Saving AniList match…"),
        task = function()
            return self.match:fetchConfirm()
        end,
        on_success = function(data)
            self.match:applyConfirm(data, nil)
            UIManager:show(InfoMessage:new{ text = _("AniList tracking enabled.") })
            self:finish()
        end,
    }
end

function TrackerMatchView:confirmDoNotTrack()
    UIManager:show(ConfirmBox:new{
        text = _("Turn off AniList tracking for this manga?"),
        ok_text = _("Do Not Track"),
        ok_callback = function()
            Retry.run{
                net = self.net,
                auth = self.auth,
                text = _("Updating tracking…"),
                task = function()
                    return self.match:fetchDoNotTrack()
                end,
                on_success = function(data)
                    self.match:applyDoNotTrack(data, nil)
                    UIManager:show(InfoMessage:new{ text = _("AniList tracking is off.") })
                    self:finish()
                end,
            }
        end,
    })
end

function TrackerMatchView:finish()
    UIManager:close(self)
    if self.on_changed then
        self.on_changed()
    end
end

function TrackerMatchView:render()
    local rows = {}
    if not self.loaded then
        rows[#rows + 1] = { text = _("Loading matches…") }
    elseif self.match:getError() then
        rows[#rows + 1] = {
            text = ErrorText.text(self.match:getError()),
            mandatory = _("Tap to retry"),
            callback = function() self:loadCandidates() end,
        }
    elseif #self.match:getCandidates() == 0 then
        rows[#rows + 1] = { text = _("No AniList matches found.") }
    else
        for index, candidate in ipairs(self.match:getCandidates()) do
            local row = {
                text = candidate_menu_text(candidate),
                mandatory = candidate_metadata(candidate),
                callback = function() self:confirmCandidate(index) end,
            }
            local bytes = self.match:getCandidateCover(index)
            if bytes then
                row.state = CoverThumbnail.build(bytes, COVER_W, COVER_H)
            end
            rows[#rows + 1] = row
        end
    end
    rows[#rows + 1] = {
        text = _("Do Not Track"),
        callback = function() self:confirmDoNotTrack() end,
    }
    self:switchItemTable(self.manga_title or _("Track on AniList"), rows)
end

function TrackerMatchView:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

function TrackerMatchView.confirmClear(opts)
    UIManager:show(ConfirmBox:new{
        text = _("Remove this manga from AniList tracking?"),
        ok_text = _("Remove"),
        ok_callback = function()
            Retry.run{
                net = opts.net,
                auth = opts.auth,
                text = _("Removing AniList tracking…"),
                task = function()
                    return opts.match:fetchClear()
                end,
                on_success = function(data)
                    opts.match:applyClear(data, nil)
                    UIManager:show(InfoMessage:new{ text = _("Removed from AniList tracking.") })
                    if opts.on_changed then
                        opts.on_changed()
                    end
                end,
            }
        end,
    })
end

return TrackerMatchView
