-- The screen behind the KoManga menu entry: a Menu driving state/browse.lua, running
-- every API call through net.lua. Two modes share the one Menu (switchItemTable):
-- sources (selecting one prompts for a query) and results (a "Load more" row while
-- more pages exist, plus a back arrow to the source list).
local Menu = require("ui/widget/menu")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local UIManager = require("ui/uimanager")
local CoverThumbnail = require("ui/cover_thumbnail")
local T = require("ffi/util").template
local _ = require("gettext")

-- COVER_H is a nominal upper bound; coverSlot caps the height to the menu's real row
-- height so a full-aspect cover can't bleed into the next row (an on-device finding).
local COVER_ASPECT = 5 / 7
local COVER_H = 112
local COVER_W = math.floor(COVER_H * COVER_ASPECT)
local COVER_MARGIN = 2

local SourceBrowser = Menu:extend{
    name = "komanga_source_browser",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    -- Collaborators injected by main.lua:
    browse = nil,       -- state/browse.lua instance
    covers = nil,       -- state/covers.lua instance (cover prefetch + cache)
    net = nil,          -- net.lua wrapper (the single network path)
    auth = nil,         -- state/auth.lua (optional — route a 401 to the prompt)
    show_details = nil, -- function(manga): open the manga-details screen
}

function SourceBrowser:init()
    self.item_table = {}
    self.paths = {} -- empty in source mode → back arrow disabled (Menu convention)
    Menu.init(self)
end

local function err_text(err)
    if not err then
        return _("Something went wrong.")
    elseif err.kind == "http" then
        if err.status == 401 then
            return _("Not authorised — check your credential.")
        end
        return T(_("Server error (%1)."), tostring(err.status or "?"))
    elseif err.kind == "transport" then
        return _("Network error — is Wi-Fi on?")
    elseif err.kind == "decode" then
        return _("Unexpected response from the server.")
    end
    return _("Something went wrong.")
end

-- A 401 routes back to credential entry; any other error is shown in place.
function SourceBrowser:handleError(err)
    if not err then
        return false
    end
    if err.kind == "cancelled" then
        return true -- user dismissed the loading dialog; leave the panel as-is
    end
    if self.auth and self.auth:handleError(err) then
        return true
    end
    UIManager:show(InfoMessage:new{ text = err_text(err) })
    return true
end

-- Called by main.lua after the widget is shown.
function SourceBrowser:start()
    self:loadSources()
end

-- --- Source list ---------------------------------------------------------------

function SourceBrowser:loadSources()
    self.net:run(function()
        return self.browse:fetchSources()
    end, {
        text = _("Loading sources…"),
        on_result = function(data, err)
            self.browse:applySources(data, err)
            self:renderSources()
        end,
    })
end

function SourceBrowser:renderSources()
    self.paths = {}
    self.state_w = 0 -- source rows carry no cover; don't indent their text
    if self.browse:getError() then
        self:handleError(self.browse:getError())
    end

    local item_table = {}
    local sources = self.browse:getSources()
    if #sources == 0 then
        item_table[1] = {
            text = _("No sources available. Tap to retry."),
            callback = function() self:loadSources() end,
        }
    else
        for _, source in ipairs(sources) do
            local label = source.name or source.id
            if source.lang then
                label = T("%1 (%2)", label, source.lang)
            end
            item_table[#item_table + 1] = {
                text = label,
                callback = function() self:promptSearch(source) end,
            }
        end
    end
    self:switchItemTable(_("KoManga — Sources"), item_table)
end

-- --- Search --------------------------------------------------------------------

function SourceBrowser:promptSearch(source)
    local dialog
    dialog = InputDialog:new{
        title = T(_("Search %1"), source.name or source.id),
        input = "",
        input_hint = _("Title to search for"),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function() UIManager:close(dialog) end,
                },
                {
                    text = _("Search"),
                    is_enter_default = true,
                    callback = function()
                        local query = dialog:getInputText()
                        UIManager:close(dialog)
                        if query and query ~= "" then
                            self:runSearch(source, query)
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function SourceBrowser:runSearch(source, query)
    self.net:run(function()
        return self.browse:fetchSearch(source.id, query)
    end, {
        text = _("Searching…"),
        on_result = function(data, err)
            self.browse:applySearch(source.id, query, data, err)
            self:renderResults()
            self:loadCovers()
        end,
    })
end

-- Height capped to the menu's actual row height so a cover can't overflow into the
-- next row; falls back to the nominal slot before the menu has computed a row height.
function SourceBrowser:coverSlot()
    local h = COVER_H
    if self.item_dimen and self.item_dimen.h and self.item_dimen.h > 0 then
        h = math.min(COVER_H, self.item_dimen.h - 2 * COVER_MARGIN)
    end
    local w = math.min(COVER_W, math.floor(h * COVER_ASPECT))
    return w, h
end

function SourceBrowser:renderResults()
    self.paths = { { mode = "results" } } -- non-empty → back arrow enabled
    local cover_w, cover_h = self:coverSlot()
    self.state_w = cover_w -- reserve the left column for cover thumbnails
    if self.browse:getError() then
        self:handleError(self.browse:getError())
    end

    local item_table = {}
    if self.browse:isEmpty() then
        item_table[1] = { text = _("No results.") }
    else
        for _, manga in ipairs(self.browse:getResults()) do
            local item = {
                text = manga.title or manga.id,
                callback = function() self:openManga(manga) end,
            }
            -- A ready cover renders as the row's left widget; otherwise text only.
            if self.covers and self.covers:isReady(manga.id) then
                item.state = CoverThumbnail.build(self.covers:getBytes(manga.id), cover_w, cover_h)
            end
            item_table[#item_table + 1] = item
        end
        if self.browse:hasMore() then
            item_table[#item_table + 1] = {
                text = _("Load more…"),
                callback = function() self:loadMore() end,
            }
        end
    end
    self:switchItemTable(T(_("Search: %1"), self.browse:getQuery()), item_table)
end

-- One-shot per call (only the planner's new ids are fetched) so it can't loop with
-- renderResults; then re-render so the arrived covers appear.
function SourceBrowser:loadCovers()
    if not self.covers then
        return
    end
    local ids = {}
    for _, manga in ipairs(self.browse:getResults()) do
        ids[#ids + 1] = manga.id
    end
    local batch = self.covers:plan(ids)
    if #batch == 0 then
        return
    end
    self.net:run(function()
        return self.covers:fetch(batch)
    end, {
        text = _("Loading covers…"),
        on_result = function(results, err)
            if err then
                return -- covers are optional; a failed pass just leaves text
            end
            self.covers:apply(results)
            self:renderResults()
        end,
    })
end

function SourceBrowser:loadMore()
    if not self.browse:hasMore() then
        return
    end
    self.net:run(function()
        return self.browse:fetchMore()
    end, {
        text = _("Loading more…"),
        on_result = function(data, err)
            self.browse:applyMore(data, err)
            self:renderResults()
            self:loadCovers()
        end,
    })
end

function SourceBrowser:openManga(manga)
    if self.show_details then
        self.show_details(manga)
    end
end

-- --- Navigation ----------------------------------------------------------------

-- Keep the menu open on a tap and run the row's action (the default closes the whole
-- menu, which suits a file picker, not a browser).
function SourceBrowser:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

function SourceBrowser:onReturn()
    self:renderSources()
    return true
end

return SourceBrowser
