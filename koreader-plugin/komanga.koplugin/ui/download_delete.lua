-- KRP-807 — delete a downloaded chapter. Behind a ConfirmBox, it drops the
-- device-local index entry (state/downloads.lua:remove, KRP-802) AND unlinks the
-- on-device CBZ so storage is actually freed. downloads:remove stays filesystem-free
-- (it only returns the path the caller must unlink), so the os.remove lives here in
-- the UI layer (CLAUDE.md §5). Shared by the library "Downloaded" row and the
-- in-reader KoManga menu so the confirm + delete UX lives in one place.
local ConfirmBox = require("ui/widget/confirmbox")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local DownloadDelete = {}

-- Confirm, then remove the index entry + unlink the CBZ. on_deleted() runs after a
-- successful removal so the caller can refresh its view.
-- opts = { downloads, chapter, on_deleted? }
function DownloadDelete.confirm(opts)
    UIManager:show(ConfirmBox:new{
        text = _("Delete this downloaded chapter?"),
        ok_text = _("Delete"),
        ok_callback = function()
            local path = opts.downloads:remove(opts.chapter.chapterId)
            if path then
                os.remove(path)
            end
            if opts.on_deleted then
                opts.on_deleted()
            end
        end,
    })
end

return DownloadDelete
