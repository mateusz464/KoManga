-- KRP-604 — Library / home view (UI). The home screen: the manga the user follows,
-- a per-manga continue-reading shortcut, and the list of downloaded chapters. Built
-- on KOReader's Menu widget (CLAUDE.md §5/§7: lean on KOReader widgets, no
-- hand-rolled layout). It drives the pure state/library.lua logic (KRP-603) and runs
-- every API call through net.lua (KRP-305) so the panel never freezes and a call
-- with wifi off prompts/enables wifi.
--
-- One Menu holds two labelled sections — "Following" and "Downloaded" — each with
-- its own empty/loading state so a slow or empty side never leaves a blank panel
-- (CLAUDE.md §9). Tapping a followed manga resolves its last-read position and jumps
-- into the reader (or opens details when it was never read); tapping a completed
-- download opens that chapter. The heavy work — resolving the target, fetching
-- reading direction, launching the reader — lives in main.lua's injected
-- collaborators, so no business logic leaks into the view (CLAUDE.md §5).
--
-- NOTE: library entries carry only a mangaId (the API has no richer library
-- endpoint yet — RFC §14), so a followed row is labelled by its id until an
-- API-epic ticket adds titles (state/library.lua's note; CLAUDE.md §6/§10).
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
    -- Collaborators, injected by main.lua (CLAUDE.md §9):
    library = nil,          -- state/library.lua instance
    net = nil,              -- net.lua wrapper (the single network path)
    auth = nil,             -- state/auth.lua (optional — routes a 401 to the prompt)
    continue_reading = nil, -- function(mangaId): resume/open a followed manga (KRP-602)
    open_download = nil,    -- function(download): open a completed downloaded chapter
}

function LibraryView:init()
    self.item_table = {}
    self.paths = {} -- single mode → back arrow disabled (Menu convention)
    -- Track which side has come back so a section shows "Loading…" until its own
    -- load resolves, rather than a premature "empty".
    self.library_ready = false
    self.downloads_ready = false
    Menu.init(self)
end

-- A 401 routes back to credential entry (CLAUDE.md §6, KRP-303/304); a dismissed
-- loading dialog leaves the panel as-is; any other error is shown in place.
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

-- Kick off both loads. Called by main.lua after the widget is shown. Each side
-- renders as it lands, so a slow download list never holds up the followed list.
function LibraryView:start()
    self:render()
    self:loadLibrary()
    self:loadDownloads()
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

function LibraryView:loadDownloads()
    self.net:run(function()
        return self.library:fetchDownloads()
    end, {
        text = _("Loading downloads…"),
        on_result = function(data, err)
            self.downloads_ready = true
            self.library:applyDownloads(data, err)
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

local function download_label(download)
    return download.chapterId or _("Chapter")
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
        -- Hoisted out of the loop: `_` (gettext) must not be the loop variable, and
        -- there's no need to re-translate the same label per row.
        local continue_label = _("Continue")
        for _, entry in ipairs(self.library:getEntries()) do
            local manga_id = entry.mangaId
            item_table[#item_table + 1] = {
                text = manga_id,
                mandatory = continue_label,
                callback = function()
                    if self.continue_reading then
                        self.continue_reading(manga_id)
                    end
                end,
            }
        end
    end

    -- Downloaded -----------------------------------------------------------------
    item_table[#item_table + 1] = heading(_("— Downloaded —"))
    if not self.downloads_ready then
        item_table[#item_table + 1] = { text = _("Loading…") }
    else
        local downloads = self.library:getDownloads()
        if #downloads == 0 then
            item_table[#item_table + 1] = { text = _("No downloaded chapters.") }
        else
            local open_label = _("Open")
            for _, download in ipairs(downloads) do
                local openable = self.library.isOpenable(download)
                item_table[#item_table + 1] = {
                    text = download_label(download),
                    -- A non-completed build isn't openable — show its status so the
                    -- row is never a dead, unexplained tap (CLAUDE.md §9).
                    mandatory = openable and open_label or download.status,
                    callback = openable and function()
                        if self.open_download then
                            self.open_download(download)
                        end
                    end or nil,
                }
            end
        end
    end

    self:switchItemTable(T(_("KoManga — Home")), item_table)
end

-- Keep the menu open on a tap and run the row's action (the default would close the
-- whole menu, which suits a file picker, not this view). Heading / status rows have
-- no callback, so tapping them is a harmless no-op.
function LibraryView:onMenuSelect(item)
    if item.callback then
        item.callback()
    end
    return true
end

return LibraryView
