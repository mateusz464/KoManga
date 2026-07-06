-- The screen behind selecting a manga: a Menu driving state/details.lua, running
-- every API call through net.lua. It lists a follow/unfollow toggle row followed by
-- the chapter list in the order the API served it, with the last-read chapter marked.
local Menu = require("ui/widget/menu")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local CoverThumbnail = require("ui/cover_thumbnail")
local ErrorText = require("ui/errors")
local T = require("ffi/util").template
local _ = require("gettext")

local COVER_W = 80
local COVER_H = 112

local MangaDetails = Menu:extend{
    name = "komanga_manga_details",
    is_borderless = true,
    is_popout = false,
    title = _("KoManga"),
    state_w = COVER_W, -- reserve the left column for the cover thumbnail
    -- Collaborators injected by main.lua:
    details = nil,    -- state/details.lua instance
    covers = nil,     -- state/covers.lua instance (cover prefetch + cache)
    net = nil,        -- net.lua wrapper (the single network path)
    auth = nil,       -- state/auth.lua (optional — routes a 401 to the prompt)
    manga_stub = nil, -- the search-result row (title for the header before load)
    open_reader = nil, -- function(chapter): opens the chapter in the reader
}

function MangaDetails:init()
    self.item_table = {}
    Menu.init(self)
end

-- A 401 routes back to credential entry; any other error is shown in place.
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

-- Details is the main content; progress (resume marker) and follow state enrich it
-- once details land, each on its own network call.
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

    -- Follow / unfollow toggle row, doubling as the cover header.
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

function MangaDetails:openChapter(chapter)
    if self.open_reader then
        self.open_reader(chapter)
    end
end

-- Keep the menu open on a tap and run the row's action (the default closes the whole
-- menu, which suits a file picker, not this view).
function MangaDetails:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

return MangaDetails
