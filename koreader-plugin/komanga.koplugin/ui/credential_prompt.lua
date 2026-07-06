-- The runtime launcher state/auth.lua's `on_prompt` points at: an InputDialog for the
-- credential that saves via Auth:setCredential. Confined here so state/auth.lua stays
-- KOReader-free and busted-testable.
local InputDialog = require("ui/widget/inputdialog")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local CredentialPrompt = {}

-- Seeded with any existing credential so a re-prompt (e.g. after a 401) shows the
-- stale value to correct rather than a blank field.
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
