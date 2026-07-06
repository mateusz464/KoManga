-- Pure classification of api/client.lua's typed errors for the reader flows'
-- loading/retry states. The on-panel wording lives in ui/errors.lua.
local Errors = {}

-- A dismissed net.lua loading dialog surfaces as { kind = "cancelled" }: the user
-- chose to stop, so callers leave the panel as-is rather than erroring or retrying.
function Errors.isCancelled(err)
    return err ~= nil and err.kind == "cancelled"
end

-- Transport (wifi asleep/flaky), a server 5xx, and a build failure are re-attemptable.
-- A 401 is routed to re-auth instead (state/auth.lua); other 4xx (e.g. 404) are permanent.
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
