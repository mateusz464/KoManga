-- KRP-502/606 — Open chapter in KOReader's reader (glue). Takes an acquired
-- chapter from state/reader.lua (KRP-501) all the way into KOReader's native CBZ
-- reader: acquire the eink CBZ, stream its bytes to a file in the plugin's
-- downloads dir, honour the manga's reading direction (RTL/LTR), then hand the file
-- to ReaderUI:showReader. All KOReader-API coupling (ReaderUI, DocSettings,
-- DataStorage, the filesystem) is confined here so state/ stays pure (CLAUDE.md
-- §5/§12); the network call goes through net.lua (wifi-gated, non-blocking — §7).
--
-- Reading uses the TRANSIENT read path (KRP-606): a single GET streams the eink CBZ
-- straight to a file, WITHOUT persisting a download record, so a chapter that was
-- only read never shows up under "Downloaded" (only the explicit "Download this
-- chapter for offline" action, ui/reader_menu.lua, persists one). The fetch runs in
-- net.lua's forked sub-process; only the small file path is marshalled back
-- (KRP-305) — the tens-of-MB CBZ stays on disk (api streams to a file sink).
local ReaderUI = require("apps/reader/readerui")
local DocSettings = require("docsettings")
local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Retry = require("ui/retry")
local util = require("util")
local _ = require("gettext")

local ReaderLauncher = {}

-- Downloaded CBZs live under the data dir, kept off the settings/docsettings dirs.
local function downloads_dir()
    local dir = DataStorage:getDataDir() .. "/komanga/downloads"
    util.makePath(dir)
    return dir
end

-- A chapter id can be an opaque source-prefixed string, so sanitise it into a safe
-- single-segment filename before using it on disk.
local function cbz_path(chapterId)
    local name = tostring(chapterId):gsub("[^%w%-_]", "_")
    return downloads_dir() .. "/" .. name .. ".cbz"
end

-- Record reader display settings into the document's settings sidecar before
-- opening, so KOReader's reader picks them up at load (it reads these from the doc
-- config on open), plus the KoManga chapter identity for the in-reader menu:
--   * inverse_reading_order — RTL → invert page-turn order; LTR written explicitly
--     so it's deterministic rather than inheriting the global default.
--   * zoom_mode "page" — fit the WHOLE page within the panel. KOReader's default is
--     "pagewidth", which scales a portrait manga page to the panel width and lets
--     its height overflow off-screen (the top gets cut off). "page" fits both
--     dimensions, so the entire page is visible with no overflow (KM-99).
--   * kopt_page_scroll 0 — force paged mode. KOReader defaults CBZ/PDF to
--     continuous (scroll) mode, which stacks pages vertically so the tail of one
--     page and the head of the next share the screen. 0 = one page per screen,
--     which is what a manga reader wants (KM-99).
local function apply_reader_settings(opts)
    local doc_settings = DocSettings:open(opts.path)
    doc_settings:saveSetting("inverse_reading_order", opts.direction == "rtl")
    doc_settings:saveSetting("zoom_mode", "page")
    doc_settings:saveSetting("kopt_page_scroll", 0)
    -- Stash the KoManga chapter identity + display metadata so the in-reader menu
    -- (ui/reader_menu.lua, KRP-506/804) can offer chapter actions for this document
    -- and download it for offline with its title / chapter number / direction
    -- WITHOUT a network call, and so it all survives the CBZ being reopened later from
    -- the file manager. Written to the sidecar KOReader reads at open (same mechanism
    -- as the display settings).
    doc_settings:saveSetting("komanga_chapter_id", opts.chapter_id)
    if opts.manga_id ~= nil then
        doc_settings:saveSetting("komanga_manga_id", opts.manga_id)
    end
    doc_settings:saveSetting("komanga_title", opts.title)
    doc_settings:saveSetting("komanga_chapter_number", opts.chapter_number)
    doc_settings:saveSetting("komanga_direction", opts.direction)
    doc_settings:flush()
end

-- Open a chapter in KOReader's native reader.
--   opts = { reader, chapter_id, manga_id, title, chapter_number, direction, net, auth? }
-- `reader` is a state/reader.lua instance; `direction` is "rtl"/"ltr" (RTL inverts the
-- page-turn order). title/chapter_number are stashed for the in-reader offline
-- download action (KRP-804).
function ReaderLauncher.open(opts)
    local path = cbz_path(opts.chapter_id)
    -- Acquire the eink CBZ via the transient read path (no persisted download),
    -- streamed straight to `path` inside net.lua's forked subprocess (api streams
    -- the HTTP body to a file sink), so a chapter's tens of MB never cross the
    -- subprocess pipe — only the small path is marshalled back. Returning the bytes
    -- instead OOMs the device: the child's serialisation fails, the caller gets nil,
    -- and the reader silently never opens (KRP-502 bug fix). Retry.run gives the
    -- loading/retry state (KRP-506): a slow fetch shows a dismissable dialog, a
    -- transient failure offers Retry rather than dead-ending on a blank panel.
    Retry.run{
        net = opts.net,
        auth = opts.auth,
        text = _("Preparing chapter…"),
        task = function()
            return opts.reader:fetchCbz(path)
        end,
        on_success = function(saved_path)
            if not saved_path then
                UIManager:show(InfoMessage:new{ text = _("Could not load the chapter.") })
                return
            end
            apply_reader_settings{
                path = saved_path,
                direction = opts.direction,
                chapter_id = opts.chapter_id,
                manga_id = opts.manga_id,
                title = opts.title,
                chapter_number = opts.chapter_number,
            }
            ReaderUI:showReader(saved_path)
        end,
    }
end

return ReaderLauncher
