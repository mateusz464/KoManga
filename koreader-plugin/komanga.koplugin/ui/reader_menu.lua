-- KRP-506 — the in-reader KoManga menu. When a KoManga chapter is open in
-- KOReader's native reader, this adds a "KoManga" entry to the reader menu with the
-- chapter actions this ticket calls for (download-this-chapter for offline). It is
-- attached to KOReader's own ReaderMenu (via main.lua's addToMainMenu in reader
-- context), so opening/closing it is KOReader's menu — the reading position is
-- preserved for free, no custom overlay to disturb it (KRP-506 acceptance #3).
--
-- Which chapter is open is recovered from the DocSettings sidecar the launcher
-- stashed at open time (ui/reader_launcher.lua writes komanga_chapter_id /
-- komanga_manga_id); a document without them isn't a KoManga chapter, so no menu is
-- offered. Reading the sidecar (not a live handle to the launcher's state) means the
-- menu also works for a downloaded chapter reopened later straight from the file
-- manager. All KOReader coupling stays here + reader_launcher (CLAUDE.md §5/§12).
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Retry = require("ui/retry")
local DownloadCoordinator = require("state/download_coordinator")
local _ = require("gettext")

local ReaderMenu = {}

-- The KoManga chapter descriptor stashed in the open document's DocSettings sidecar
-- at launch, or nil when the open document isn't a KoManga chapter. Field names match
-- the download coordinator's `chapter` contract (KRP-804) so it can be passed straight
-- through. The display metadata (title / chapterNumber / direction) lets the offline
-- entry be labelled without a network call, and survives the CBZ being reopened later
-- from the file manager.
local function chapter_context(ui)
    if not (ui and ui.doc_settings) then
        return nil
    end
    local chapter_id = ui.doc_settings:readSetting("komanga_chapter_id")
    if not chapter_id then
        return nil
    end
    return {
        chapterId = chapter_id,
        mangaId = ui.doc_settings:readSetting("komanga_manga_id"),
        title = ui.doc_settings:readSetting("komanga_title"),
        chapterNumber = ui.doc_settings:readSetting("komanga_chapter_number"),
        direction = ui.doc_settings:readSetting("komanga_direction"),
    }
end

-- Download the chapter to the device (RFC §5.4) via the KRP-804 coordinator, with the
-- shared loading/retry state (ui/retry.lua). This is the DEVICE-LOCAL path: it streams
-- the transient eink CBZ straight to the on-device store and records the offline index
-- — it never hits the server-side POST /download. The fetch runs off-thread in
-- net.lua's fork (safe — it mutates no index); the index entry is recorded parent-side
-- in on_success (KRP-305).
local function download_chapter(opts, ctx)
    local coordinator = DownloadCoordinator.new(opts.api, opts.downloads)
    opts.downloads:ensureDir()
    Retry.run{
        net = opts.net,
        auth = opts.auth,
        text = _("Saving chapter for offline…"),
        task = function()
            return coordinator:fetchCbz(ctx)
        end,
        on_success = function(path)
            coordinator:record(ctx, path)
            UIManager:show(InfoMessage:new{ text = _("Chapter saved for offline reading.") })
        end,
    }
end

-- Build the reader-menu entry for the open document, or nil when it isn't a KoManga
-- chapter (so a non-KoManga book shows no KoManga menu).
-- opts = { ui, net, api, auth, downloads }.
-- sorting_hint drops the entry into the reader menu's "More tools" submenu (the
-- idiomatic home for plugin actions), so no edit to KOReader's menu order is needed.
function ReaderMenu.build(opts)
    local ctx = chapter_context(opts.ui)
    if not ctx then
        return nil
    end
    return {
        text = _("KoManga"),
        sorting_hint = "more_tools",
        sub_item_table = {
            {
                text = _("Download this chapter for offline"),
                keep_menu_open = true,
                callback = function()
                    download_chapter(opts, ctx)
                end,
            },
        },
    }
end

return ReaderMenu
