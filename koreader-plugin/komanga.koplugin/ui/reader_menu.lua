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
local _ = require("gettext")

local ReaderMenu = {}

-- The KoManga chapter identity stashed in the open document's DocSettings sidecar at
-- launch, or nil when the open document isn't a KoManga chapter.
local function chapter_context(ui)
    if not (ui and ui.doc_settings) then
        return nil
    end
    local chapter_id = ui.doc_settings:readSetting("komanga_chapter_id")
    if not chapter_id then
        return nil
    end
    return {
        chapter_id = chapter_id,
        manga_id = ui.doc_settings:readSetting("komanga_manga_id"),
    }
end

-- Reflect the server's download-record status on the panel (KRP-506 acceptance #2:
-- "Download chapter triggers the API download endpoint and reflects status").
local function reflect_status(data)
    local status = data and data.status
    if status == "completed" then
        UIManager:show(InfoMessage:new{ text = _("Chapter saved for offline reading.") })
    else
        -- The server builds synchronously today, so a non-completed status is a
        -- safety net rather than an expected path (mirrors reader_launcher).
        UIManager:show(InfoMessage:new{
            text = _("Chapter is still being prepared — try again shortly."),
        })
    end
end

-- POST the chapter download and reflect status, with the shared loading/retry state
-- (ui/retry.lua). A `failed` build comes back as a 2xx record, so it is surfaced as
-- a retryable build error through the task's (data, err) contract, letting Retry
-- offer a re-attempt uniformly (mirrors reader_launcher's open flow).
local function download_chapter(opts, ctx)
    Retry.run{
        net = opts.net,
        auth = opts.auth,
        text = _("Saving chapter for offline…"),
        task = function()
            local data, err = opts.api:downloadChapter(ctx.chapter_id, ctx.manga_id)
            if err then
                return nil, err
            end
            if data and data.status == "failed" then
                return nil, { kind = "build", status = "failed" }
            end
            return data, nil
        end,
        on_success = reflect_status,
    }
end

-- Build the reader-menu entry for the open document, or nil when it isn't a KoManga
-- chapter (so a non-KoManga book shows no KoManga menu). opts = { ui, net, api, auth }.
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
