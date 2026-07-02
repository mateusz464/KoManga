-- KRP-506 — run a net.lua task with a loading/retry state (CLAUDE.md §7/§9: never a
-- frozen or blank panel — a slow call shows a dismissable loading dialog, a failed
-- one a clear message with a way forward). It is the shared shape both reader paths
-- use (opening a chapter — ui/reader_launcher.lua — and the in-reader
-- download-for-offline action — ui/reader_menu.lua), so the loading/error/retry UX
-- lives in one place.
--
-- On a result:
--   * success            → on_success(data)
--   * cancelled dialog   → nothing (the user chose to stop; leave the panel as-is)
--   * 401                → routed to the credential prompt via auth (KRP-303/304)
--   * retryable failure  → a Retry/Cancel dialog that re-runs the SAME task
--   * anything else      → a single on-panel error line
-- All network still flows through net.lua (wifi-gated, non-blocking); this only
-- wraps its result handling.
local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local ErrorText = require("ui/errors")
local ApiError = require("state/errors")
local _ = require("gettext")

local Retry = {}

-- opts = {
--   net,                       -- net.lua wrapper (the single network path)
--   auth?,                     -- state/auth.lua (routes a 401 to the prompt)
--   text = <loading label>,    -- shown while the call runs
--   task = function() -> (data, err),  -- an api/client.lua call (run off-thread)
--   on_success = function(data),       -- parent-side, on a 2xx
-- }
function Retry.run(opts)
    opts.net:run(opts.task, {
        text = opts.text,
        on_result = function(data, err)
            if not err then
                if opts.on_success then
                    opts.on_success(data)
                end
                return
            end
            if ApiError.isCancelled(err) then
                return -- user dismissed the loading dialog; leave the panel as-is
            end
            if opts.auth and opts.auth:handleError(err) then
                return -- a 401 was routed back to the credential prompt
            end
            if ApiError.isRetryable(err) then
                UIManager:show(ConfirmBox:new{
                    text = ErrorText.text(err) .. "\n" .. _("Try again?"),
                    ok_text = _("Retry"),
                    ok_callback = function()
                        Retry.run(opts)
                    end,
                })
            else
                UIManager:show(InfoMessage:new{ text = ErrorText.text(err) })
            end
        end,
    })
end

return Retry
