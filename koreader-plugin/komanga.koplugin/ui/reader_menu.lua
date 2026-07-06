-- The in-reader KoManga menu: a "KoManga" entry on KOReader's own reader menu (so the
-- reading position is preserved for free) offering the chapter's offline actions.
-- Which chapter is open is recovered from the DocSettings sidecar the launcher
-- stashed — reading the sidecar rather than a live handle means the menu also works
-- for a downloaded chapter reopened later from the file manager.
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local Retry = require("ui/retry")
local DownloadCoordinator = require("state/download_coordinator")
local DownloadDelete = require("ui/download_delete")
local _ = require("gettext")

local ReaderMenu = {}

-- The chapter descriptor from the sidecar, or nil when the document isn't a KoManga
-- chapter. Field names match the download coordinator's `chapter` contract so it can
-- be passed straight through.
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

-- The device-local download path (RFC §5.4): stream the transient eink CBZ to the
-- on-device store and record the offline index — never the server POST /download. The
-- index entry is recorded parent-side in on_success (the fork can't mutate it).
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

-- The reader-menu entry for the open document, or nil when it isn't a KoManga chapter.
-- opts = { ui, net, api, auth, downloads }.
function ReaderMenu.build(opts)
    local ctx = chapter_context(opts.ui)
    if not ctx then
        return nil
    end
    local sub_items = {
        {
            text = _("Download this chapter for offline"),
            keep_menu_open = true,
            callback = function()
                download_chapter(opts, ctx)
            end,
        },
    }
    -- Offer delete only once the chapter is actually downloaded.
    if opts.downloads:has(ctx.chapterId) then
        sub_items[#sub_items + 1] = {
            text = _("Delete this download"),
            keep_menu_open = true,
            callback = function()
                DownloadDelete.confirm{
                    downloads = opts.downloads,
                    chapter = ctx,
                    on_deleted = function()
                        UIManager:show(InfoMessage:new{ text = _("Download deleted.") })
                    end,
                }
            end,
        }
    end
    return {
        text = _("KoManga"),
        sorting_hint = "more_tools", -- drop into the reader menu's "More tools" submenu

        sub_item_table = sub_items,
    }
end

return ReaderMenu
