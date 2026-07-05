-- KRP-604 — Library / home view (UI). The home screen: the manga the user follows,
-- a per-manga continue-reading shortcut, and the list of downloaded chapters. Built
-- on KOReader's Menu widget (CLAUDE.md §5/§7: lean on KOReader widgets, no
-- hand-rolled layout). It drives the pure state/library.lua logic (KRP-603) and runs
-- every API call through net.lua (KRP-305) so the panel never freezes and a call
-- with wifi off prompts/enables wifi.
--
-- One Menu holds two labelled sections — "Following" and "Downloaded". The followed
-- list loads over the network with its own empty/loading state so a slow or empty
-- side never leaves a blank panel (CLAUDE.md §9); the Downloaded list reads the
-- device-local index (KRP-805), so it renders with wifi off and needs no loading
-- state. Tapping a followed manga resolves its last-read position and jumps into the
-- reader (or opens details when it was never read); tapping a downloaded chapter
-- opens its local CBZ. The heavy work — resolving the target, fetching reading
-- direction, launching the reader — lives in main.lua's injected collaborators, so no
-- business logic leaks into the view (CLAUDE.md §5).
--
-- NOTE: a followed row is labelled by the manga's display title, captured at
-- follow time (API-908) and carried on the library entry; it falls back to the
-- raw mangaId when the API omits a title (state/library.lua:entryTitle).
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
    continue_reading = nil, -- function(entry): open a followed manga's continue target (KRP-607)
    open_download = nil,    -- function(download): open a completed downloaded chapter
}

function LibraryView:init()
    self.item_table = {}
    self.paths = {} -- single mode → back arrow disabled (Menu convention)
    -- The followed side loads over the network, so it shows "Loading…" until its
    -- fetch resolves; the Downloaded side is a local device-index read (KRP-805), so
    -- it renders immediately with no loading state.
    self.library_ready = false
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

-- Render the screen and kick off the followed-list load. Called by main.lua after
-- the widget is shown. The Downloaded section reads the device index straight from
-- the first render (no network), so only the followed list needs an async load.
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
            -- The mandatory shows the next chapter to read (e.g. "Continue (41)"),
            -- "Caught Up", or a bare "Continue" fallback (state/library.lua, KRP-607);
            -- main.lua decides where the tap goes from the entry's continue target.
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

    -- Downloaded (device-local index, KRP-805) -----------------------------------
    -- Read straight from the on-device index, so it renders with wifi off; every row
    -- is a completed local CBZ, labelled by manga title + chapter number.
    item_table[#item_table + 1] = heading(_("— Downloaded —"))
    local downloads = self.library:getDownloads()
    if #downloads == 0 then
        item_table[#item_table + 1] = { text = _("No downloaded chapters.") }
    else
        for _, download in ipairs(downloads) do
            item_table[#item_table + 1] = {
                text = self.library.downloadTitle(download),
                mandatory = self.library.downloadNumber(download),
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
