-- KRP-304 — credential entry (InputDialog). The KOReader-runtime launcher that
-- state/auth.lua's `on_prompt` points at: it shows an InputDialog for the single
-- API credential and, on save, stores it via Auth:setCredential (which persists
-- through Settings/LuaSettings). All KOReader-API coupling lives here, not in
-- state/auth.lua, so an upgrade breaks few modules (CLAUDE.md §12) and the auth
-- logic stays busted-testable.
local InputDialog = require("ui/widget/inputdialog")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local CredentialPrompt = {}

-- Show the credential-entry dialog. `auth` is a state/auth.lua instance; the
-- dialog is seeded with any existing credential so a re-prompt (e.g. after a 401)
-- shows the stale value to correct rather than a blank field.
function CredentialPrompt.show(auth)
    local dialog
    dialog = InputDialog:new{
        title = _("KoManga credential"),
        input = auth:getCredential() or "",
        input_hint = _("API credential"),
        description = _("The single credential the server expects on every request."),
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
                        auth:setCredential(dialog:getInputText())
                        UIManager:close(dialog)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
    return dialog
end

return CredentialPrompt
