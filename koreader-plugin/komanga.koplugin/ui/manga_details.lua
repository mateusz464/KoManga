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
local CoverThumbnail = require("ui/cover_thumbnail")
local ErrorText = require("ui/errors")
local T = require("ffi/util").template
local _ = require("gettext")

-- Cover slot size on the details header row (KRP-406); on-device tuning is KRP-701.
local COVER_W = 80
local COVER_H = 112

local MangaDetails = Menu:extend{
    name = "komanga_manga_details",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    state_w = COVER_W, -- reserve the left column for the cover thumbnail (KRP-406)
    -- Collaborators, injected by main.lua (CLAUDE.md §9):
    details = nil,    -- state/details.lua instance
    covers = nil,     -- state/covers.lua instance (cover prefetch + cache)
    net = nil,        -- net.lua wrapper (the single network path)
    auth = nil,       -- state/auth.lua (optional — routes a 401 to the prompt)
    manga_stub = nil, -- the search-result row (title for the header before load)
    open_reader = nil, -- function(chapter): opens the chapter in the reader (KRP-502)
}

function MangaDetails:init()
    self.item_table = {}
    Menu.init(self)
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
    UIManager:show(InfoMessage:new{ text = ErrorText.text(err) })
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
                self:loadCover()
                self:loadProgress()
                self:loadFollowState()
            end
        end,
    })
end

-- Fetch this manga's cover through the single network path (net.lua: non-blocking +
-- wifi-gated) and re-render so it appears on the header row. One-shot (the planner
-- dedups), and a missing/failed cover simply leaves the header text (KRP-406).
function MangaDetails:loadCover()
    if not self.covers then
        return
    end
    local batch = self.covers:plan({ self.details:getMangaId() })
    if #batch == 0 then
        return
    end
    self.net:run(function()
        return self.covers:fetch(batch)
    end, {
        text = _("Loading cover…"),
        on_result = function(results, err)
            if err then
                return -- the cover is optional; on failure the header stays text
            end
            self.covers:apply(results)
            self:render()
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

    -- Follow / unfollow toggle row, doubling as the cover header: a ready cover
    -- renders as its left widget, otherwise the row is just text (KRP-406).
    local header = {
        text = self.details:isFollowed()
            and _("★ In library — tap to remove")
            or _("☆ Add to library"),
        callback = function() self:toggleFollow() end,
    }
    if self.covers and self.covers:isReady(self.details:getMangaId()) then
        header.state = CoverThumbnail.build(
            self.covers:getBytes(self.details:getMangaId()), COVER_W, COVER_H)
    end
    item_table[#item_table + 1] = header

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

-- Open the tapped chapter in KOReader's native reader (KRP-502). The collaborator
-- construction (Reader state + the launcher) lives in main.lua; this just hands off
-- the chapter so no business logic leaks into the view (CLAUDE.md §5).
function MangaDetails:openChapter(chapter)
    if self.open_reader then
        self.open_reader(chapter)
    end
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
