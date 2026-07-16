-- Takes an acquired chapter from state/reader.lua into KOReader's native CBZ reader:
-- stream the eink CBZ to a file, honour the manga's reading direction, then hand the
-- file to ReaderUI:showReader. Confines all KOReader-API coupling so state/ stays
-- pure. Reading uses the transient read path (a single GET, no persisted download);
-- only the explicit "Download for offline" action persists one.
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

-- Written to the document's settings sidecar before opening, since KOReader's reader
-- reads these at load. The display settings are all deliberate:
--   * inverse_reading_order — RTL inverts page-turn order; LTR written explicitly so
--     it doesn't inherit the global default.
--   * zoom_mode "page" — fit the WHOLE page. The default "pagewidth" scales a
--     portrait page to the panel width and overflows its height off-screen (KM-99).
--   * kopt_page_scroll 0 — paged mode. The default continuous mode stacks pages so
--     the tail of one and the head of the next share the screen (KM-99).
-- The komanga_* keys stash the chapter identity + metadata so the in-reader menu can
-- act on this document (and label an offline download) without a network call, even
-- after the CBZ is reopened later from the file manager.
local function apply_reader_settings(opts)
    local doc_settings = DocSettings:open(opts.path)
    doc_settings:saveSetting("inverse_reading_order", opts.direction == "rtl")
    doc_settings:saveSetting("zoom_mode", "page")
    doc_settings:saveSetting("kopt_page_scroll", 0)
    doc_settings:saveSetting("komanga_chapter_id", opts.chapter_id)
    if opts.manga_id ~= nil then
        doc_settings:saveSetting("komanga_manga_id", opts.manga_id)
    end
    doc_settings:saveSetting("komanga_title", opts.title)
    doc_settings:saveSetting("komanga_chapter_number", opts.chapter_number)
    doc_settings:saveSetting("komanga_direction", opts.direction)
    doc_settings:flush()
end

-- opts = { reader, chapter_id, manga_id, title, chapter_number, direction, net, auth?,
--          on_before_show? }
-- on_before_show fires only once the CBZ is acquired, right before the reader takes
-- over — a failed or cancelled fetch leaves the caller's windows untouched.
function ReaderLauncher.open(opts)
    local path = cbz_path(opts.chapter_id)
    -- fetchCbz streams straight to `path` inside net.lua's fork; only the small path
    -- is marshalled back. Returning the bytes instead OOMs the device on a large CBZ.
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
            if opts.on_before_show then
                opts.on_before_show()
            end
            ReaderUI:showReader(saved_path)
        end,
    }
end

return ReaderLauncher
