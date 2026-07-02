-- KRP-506 — shared classification of api/client.lua's typed errors, used by the
-- reader flows' loading/retry states (CLAUDE.md §5: pure, framework-free,
-- busted-testable with no KOReader loaded). The on-panel wording of an error lives
-- in ui/errors.lua (gettext belongs in ui/); this module is only the decisions.
local Errors = {}

-- A user-dismissed net.lua loading dialog surfaces as { kind = "cancelled" } — the
-- user chose to stop, not a failure; callers leave the panel as-is rather than
-- showing an error or a retry (KRP-305/506).
function Errors.isCancelled(err)
    return err ~= nil and err.kind == "cancelled"
end

-- Whether a failed op is worth offering a Retry for (KRP-506: a slow/failed fetch
-- shows a clear loading/retry state). Transport (wifi asleep/flaky), a server 5xx,
-- and a build failure are transient/re-attemptable. A 401 is NOT retried here — it
-- is routed to re-auth (state/auth.lua) — and other 4xx (e.g. a 404) are permanent.
function Errors.isRetryable(err)
    if not err then
        return false
    end
    if err.kind == "transport" or err.kind == "build" then
        return true
    end
    if err.kind == "http" then
        return err.status ~= nil and err.status >= 500
    end
    return false
end

return Errors
