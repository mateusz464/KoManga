-- Confirm, then drop the device-local index entry AND unlink the on-device CBZ so
-- storage is freed. downloads:remove stays filesystem-free (it only returns the path
-- to unlink), so the os.remove lives here in the UI layer.
local ConfirmBox = require("ui/widget/confirmbox")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local DownloadDelete = {}

-- on_deleted() runs after a successful removal so the caller can refresh its view.
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
