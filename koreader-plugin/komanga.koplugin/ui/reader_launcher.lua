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
local util = require("util")
local T = require("ffi/util").template
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

-- Turn the api/client.lua typed error into one on-panel line (CLAUDE.md §9: never a
-- blank panel — every failure gets a visible state).
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
    elseif err.kind == "build" then
        return _("This chapter could not be prepared for reading.")
    end
    return _("Something went wrong.")
end

-- A 401 routes back to credential entry (CLAUDE.md §6, KRP-303/304); a user-dismissed
-- loading dialog leaves the panel as-is; any other error is shown in place.
local function handle_error(err, auth)
    if not err or err.kind == "cancelled" then
        return
    end
    if auth and auth:handleError(err) then
        return
    end
    UIManager:show(InfoMessage:new{ text = err_text(err) })
end

-- Record the reading direction into the document's settings sidecar before opening,
-- so KOReader's reader picks it up at load (readerview reads inverse_reading_order
-- from the doc config). RTL → invert page-turn order; LTR is written explicitly so
-- it's deterministic rather than inheriting the global default.
local function apply_reading_direction(path, rtl)
    local doc_settings = DocSettings:open(path)
    doc_settings:saveSetting("inverse_reading_order", rtl == true)
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
    opts.net:run(function()
        return opts.api:downloadChapterCbzToFile(opts.chapter_id, path)
    end, {
        text = _("Downloading chapter…"),
        on_result = function(saved_path, err)
            if err then
                handle_error(err, opts.auth)
                return
            end
            if not saved_path then
                UIManager:show(InfoMessage:new{ text = _("Could not save the chapter.") })
                return
            end

            apply_reading_direction(saved_path, opts.rtl)
            ReaderUI:showReader(saved_path)
        end,
    })
end

-- Open a chapter in KOReader's native reader.
--   opts = { reader, chapter_id, rtl, net, api, auth? }
-- `reader` is a state/reader.lua instance; `rtl` true for right-to-left manga.
function ReaderLauncher.open(opts)
    local reader = opts.reader
    -- Step 1: acquire the eink build (POST download). The blocking call runs
    -- off-thread in net.lua's fork; the record is applied here in the parent.
    opts.net:run(function()
        return reader:fetchDownload()
    end, {
        text = _("Preparing chapter…"),
        on_result = function(data, err)
            if not reader:applyDownload(data, err) then
                handle_error(reader:getError(), opts.auth)
                return
            end
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
    })
end

return ReaderLauncher
