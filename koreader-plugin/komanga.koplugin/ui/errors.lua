-- KRP-506 — the single api/client.lua-error → on-panel line mapping (CLAUDE.md §9:
-- never leave the panel blank — every failure gets a visible, legible state). This
-- is the dedup of the identical err_text copies ui/reader_launcher.lua and
-- ui/manga_details.lua each carried. gettext-wrapped wording lives in ui/ so
-- state/ stays framework-free (CLAUDE.md §5); the retryable/cancelled decisions are
-- the pure state/errors.lua.
local T = require("ffi/util").template
local _ = require("gettext")

local Errors = {}

function Errors.text(err)
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

return Errors
