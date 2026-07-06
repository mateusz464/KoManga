-- KRP-706 — server URL entry (InputDialog). Lets the user point the plugin at their
-- own API from the device, so the base URL persists in LuaSettings (settings.lua)
-- rather than requiring a hand-edit of config.lua. Persisting in settings keeps it
-- out of the plugin folder, so a plugin update (overwriting the folder) can't wipe it.
-- All KOReader-API coupling lives here, not in settings.lua, so the persistence logic
-- stays busted-testable (CLAUDE.md §12).
local InputDialog = require("ui/widget/inputdialog")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local ServerUrlPrompt = {}

-- opts = { current = <seeded URL>, on_save = function(url) }. The dialog is seeded
-- with the current base URL so the user edits it rather than retyping. An empty
-- entry is ignored (mirrors the search prompt) so the client can never be left with
-- a blank base URL.
function ServerUrlPrompt.show(opts)
    local dialog
    dialog = InputDialog:new{
        title = _("KoManga server URL"),
        input = opts.current or "",
        input_hint = _("https://your-api.example"),
        description = _("Base URL of your KoManga API (e.g. your Cloudflare Tunnel origin)."),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local url = dialog:getInputText()
                        UIManager:close(dialog)
                        if url and url ~= "" and opts.on_save then
                            opts.on_save(url)
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
    return dialog
end

return ServerUrlPrompt
