-- KRP-502 — Open chapter in KOReader's reader (glue). Takes an acquired chapter
-- from state/reader.lua (KRP-501) all the way into KOReader's native CBZ reader:
-- acquire the eink build, stream its bytes to a file in the plugin's downloads
-- dir, honour the manga's reading direction (RTL/LTR), then hand the file to
-- ReaderUI:showReader. All KOReader-API coupling (ReaderUI, DocSettings,
-- DataStorage, the filesystem) is confined here so state/ stays pure (CLAUDE.md
-- §5/§12); every network call goes through net.lua (wifi-gated, non-blocking — §7).
--
-- Two sequential net calls mirror the two-step server contract: POST the download
-- (the slow side — the server fetches + processes + builds the CBZ) then GET the
-- stored CBZ, streamed to a file. Both run in net.lua's forked sub-process; only
-- small results (the record, then the file path) are marshalled back (KRP-305).
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
    doc_settings:saveSetting("inverse_reading_order", opts.rtl == true)
    doc_settings:saveSetting("zoom_mode", "page")
    doc_settings:saveSetting("kopt_page_scroll", 0)
    -- Stash the KoManga chapter identity so the in-reader menu (ui/reader_menu.lua,
    -- KRP-506) can offer chapter actions for this document, and so it still knows
    -- the chapter when the CBZ is reopened later from the file manager. Written to
    -- the sidecar KOReader reads at open (same mechanism as the display settings).
    doc_settings:saveSetting("komanga_chapter_id", opts.chapter_id)
    if opts.manga_id ~= nil then
        doc_settings:saveSetting("komanga_manga_id", opts.manga_id)
    end
    doc_settings:flush()
end

-- Step 2: download the built CBZ to disk, then open the reader. The download
-- streams straight to `path` inside net.lua's forked subprocess (api streams the
-- HTTP body to a file sink), so a chapter's tens of MB never cross the subprocess
-- pipe — only the small path is marshalled back. Returning the bytes instead OOMs
-- the device: the child's serialisation fails, the caller gets nil, and the reader
-- silently never opens (KRP-502 bug fix).
local function download_and_open(opts)
    local path = cbz_path(opts.chapter_id)
    -- Step 2: download the built CBZ to disk, then open the reader. Retry.run gives
    -- the loading/retry state (KRP-506): a slow download shows a dismissable dialog,
    -- a transient failure offers Retry rather than dead-ending on a blank panel.
    Retry.run{
        net = opts.net,
        auth = opts.auth,
        text = _("Downloading chapter…"),
        task = function()
            return opts.api:downloadChapterCbzToFile(opts.chapter_id, path)
        end,
        on_success = function(saved_path)
            if not saved_path then
                UIManager:show(InfoMessage:new{ text = _("Could not save the chapter.") })
                return
            end
            apply_reader_settings{
                path = saved_path,
                rtl = opts.rtl,
                chapter_id = opts.chapter_id,
                manga_id = opts.manga_id,
            }
            ReaderUI:showReader(saved_path)
        end,
    }
end

-- Open a chapter in KOReader's native reader.
--   opts = { reader, chapter_id, manga_id, rtl, net, api, auth? }
-- `reader` is a state/reader.lua instance; `rtl` true for right-to-left manga.
function ReaderLauncher.open(opts)
    local reader = opts.reader
    -- Step 1: acquire the eink build (POST download). The blocking call runs
    -- off-thread in net.lua's fork; the record is applied here in the parent. A
    -- `failed` build comes back as a 2xx record, so it is surfaced as a retryable
    -- build error through the task's (data, err) contract — Retry then offers a
    -- re-attempt uniformly instead of a dead end (KRP-506).
    Retry.run{
        net = opts.net,
        auth = opts.auth,
        text = _("Preparing chapter…"),
        task = function()
            local data, err = reader:fetchDownload()
            if err then
                return nil, err
            end
            if data and data.status == "failed" then
                return nil, { kind = "build", status = "failed" }
            end
            return data, nil
        end,
        on_success = function(data)
            reader:applyDownload(data, nil)
            if not reader:isReady() then
                -- The server builds synchronously today, so a non-completed status
                -- is a safety net rather than an expected path.
                UIManager:show(InfoMessage:new{
                    text = _("Chapter is still being prepared — try again shortly."),
                })
                return
            end
            download_and_open(opts)
        end,
    }
end

return ReaderLauncher
