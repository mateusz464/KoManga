-- KRP-404 — Manga details & chapter list (UI). The screen behind selecting a
-- manga in the source browser (KRP-402), built on KOReader's Menu widget
-- (CLAUDE.md §5/§7: lean on KOReader widgets, no hand-rolled layout). It drives the
-- pure state/details.lua logic (KRP-403) and runs every API call through net.lua
-- (KRP-305) so the panel never freezes and a wifi-off call prompts/enables wifi.
--
-- The Menu lists a follow/unfollow toggle row followed by the chapter list in the
-- order the API served it, with the last-read chapter marked. Opening a chapter
-- (the reader) lands in KRP-502 — for now a result shows a stub.
--
-- No business logic lives here (CLAUDE.md §5): fetching/decisions are in details +
-- api; this module only shapes Menu rows and loading/empty/error states.
local Menu = require("ui/widget/menu")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")

local MangaDetails = Menu:extend{
    name = "komanga_manga_details",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    -- Collaborators, injected by main.lua (CLAUDE.md §9):
    details = nil,    -- state/details.lua instance
    net = nil,        -- net.lua wrapper (the single network path)
    auth = nil,       -- state/auth.lua (optional — routes a 401 to the prompt)
    manga_stub = nil, -- the search-result row (title for the header before load)
}

function MangaDetails:init()
    self.item_table = {}
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
function MangaDetails:handleError(err)
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

-- Kick off the loads. Called by main.lua after the widget is shown. Details is the
-- main content; progress (resume marker) and follow state enrich it once details
-- land, each on its own network call.
function MangaDetails:start()
    self:loadDetails()
end

function MangaDetails:loadDetails()
    self:render() -- show the stub header + a loading row immediately
    self.net:run(function()
        return self.details:fetchManga()
    end, {
        text = _("Loading details…"),
        on_result = function(data, err)
            self.details:applyManga(data, err)
            self:render()
            if not err then
                self:loadProgress()
                self:loadFollowState()
            end
        end,
    })
end

function MangaDetails:loadProgress()
    self.net:run(function()
        return self.details:fetchProgress()
    end, {
        text = _("Checking progress…"),
        on_result = function(data, err)
            self.details:applyProgress(data, err)
            self:render()
        end,
    })
end

function MangaDetails:loadFollowState()
    self.net:run(function()
        return self.details:fetchLibrary()
    end, {
        text = _("Checking library…"),
        on_result = function(data, err)
            self.details:applyLibrary(data, err)
            self:render()
        end,
    })
end

-- --- Follow / unfollow ---------------------------------------------------------

function MangaDetails:toggleFollow()
    if self.details:isFollowed() then
        self.net:run(function()
            return self.details:fetchUnfollow()
        end, {
            text = _("Removing from library…"),
            on_result = function(data, err)
                if self.details:applyUnfollow(data, err) then
                    self:render()
                else
                    self:handleError(err)
                end
            end,
        })
    else
        self.net:run(function()
            return self.details:fetchFollow(os.time())
        end, {
            text = _("Adding to library…"),
            on_result = function(data, err)
                if self.details:applyFollow(data, err) then
                    self:render()
                else
                    self:handleError(err)
                end
            end,
        })
    end
end

-- --- Rendering -----------------------------------------------------------------

local function chapter_label(chapter)
    if chapter.name and chapter.name ~= "" then
        return chapter.name
    end
    if chapter.chapterNumber then
        return T(_("Chapter %1"), tostring(chapter.chapterNumber))
    end
    return chapter.id
end

function MangaDetails:render()
    if self.details:getError() then
        self:handleError(self.details:getError())
    end

    local manga = self.details:getManga()
    local title = (manga and manga.title)
        or (self.manga_stub and (self.manga_stub.title or self.manga_stub.id))
        or _("Manga")

    local item_table = {}

    -- Follow / unfollow toggle row.
    item_table[#item_table + 1] = {
        text = self.details:isFollowed()
            and _("★ In library — tap to remove")
            or _("☆ Add to library"),
        callback = function() self:toggleFollow() end,
    }

    local chapters = self.details:getChapters()
    if not manga then
        item_table[#item_table + 1] = { text = _("Loading…") }
    elseif #chapters == 0 then
        item_table[#item_table + 1] = { text = _("No chapters.") }
    else
        for _, chapter in ipairs(chapters) do
            item_table[#item_table + 1] = {
                text = chapter_label(chapter),
                mandatory = self.details:isLastRead(chapter.id) and _("Last read") or nil,
                callback = function() self:openChapter(chapter) end,
            }
        end
    end

    self:switchItemTable(title, item_table)
end

-- Opening a chapter in KOReader's reader is KRP-502; this is a placeholder so the
-- row is not a dead tap before then.
function MangaDetails:openChapter(chapter)
    UIManager:show(InfoMessage:new{
        text = T(_("“%1” — reading lands in a later ticket."), chapter_label(chapter)),
    })
end

-- Keep the menu open on a tap and run the row's action (the default would close the
-- whole menu, which suits a file picker, not this view).
function MangaDetails:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

return MangaDetails
