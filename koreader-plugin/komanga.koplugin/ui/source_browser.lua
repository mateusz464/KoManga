-- KRP-402 — Source list & search (UI). The screen behind the KoManga menu entry,
-- built on KOReader's Menu widget (CLAUDE.md §5/§7: lean on KOReader widgets, no
-- hand-rolled layout). It drives the pure state/browse.lua logic (KRP-401) and
-- runs every API call through net.lua (KRP-305) so the panel never freezes and a
-- call with wifi off prompts/enables wifi.
--
-- Two modes share the one Menu, switched with switchItemTable:
--   * sources  — the installed sources; selecting one prompts for a search query.
--   * results  — the search results, with a "Load more" row while more pages
--                exist and a back arrow (paths) to the source list.
--
-- No business logic lives here (CLAUDE.md §5): fetching/decisions are in browse +
-- api; this module only shapes Menu rows and loading/empty/error states. Manga
-- details (selecting a result) land in KRP-404 — for now a result shows a stub.
local Menu = require("ui/widget/menu")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")

local SourceBrowser = Menu:extend{
    name = "komanga_source_browser",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    -- Collaborators, injected by main.lua (CLAUDE.md §9):
    browse = nil,       -- state/browse.lua instance
    net = nil,          -- net.lua wrapper (the single network path)
    auth = nil,         -- state/auth.lua (optional — route a 401 to the prompt)
    show_details = nil, -- function(manga): open the manga-details screen (KRP-404)
}

function SourceBrowser:init()
    self.item_table = {}
    self.paths = {} -- empty in source mode → back arrow disabled (Menu convention)
    Menu.init(self)
end

-- Turn the api/client.lua typed error into a single on-panel line (CLAUDE.md §9:
-- never leave the panel blank — every failure gets a visible state).
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

-- A 401 routes back to credential entry (CLAUDE.md §6, KRP-303/304); any other
-- error is shown in place. Returns true if the error was handled here.
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

-- Kick off the initial source load. Called by main.lua after the widget is shown.
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
        end,
    })
end

function SourceBrowser:renderResults()
    self.paths = { { mode = "results" } } -- non-empty → back arrow enabled
    if self.browse:getError() then
        self:handleError(self.browse:getError())
    end

    local item_table = {}
    if self.browse:isEmpty() then
        item_table[1] = { text = _("No results.") }
    else
        for _, manga in ipairs(self.browse:getResults()) do
            item_table[#item_table + 1] = {
                text = manga.title or manga.id,
                callback = function() self:openManga(manga) end,
            }
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
        end,
    })
end

-- Open the manga details + chapter list (KRP-404). main.lua injects show_details so
-- the collaborator wiring (api client + a fresh Details state) stays there.
function SourceBrowser:openManga(manga)
    if self.show_details then
        self.show_details(manga)
    end
end

-- --- Navigation ----------------------------------------------------------------

-- Keep the menu open on a tap and run the row's action (the default would close
-- the whole menu, which suits a file picker, not a browser).
function SourceBrowser:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

-- Back arrow (enabled only in results mode) returns to the source list.
function SourceBrowser:onReturn()
    self:renderSources()
    return true
end

return SourceBrowser
