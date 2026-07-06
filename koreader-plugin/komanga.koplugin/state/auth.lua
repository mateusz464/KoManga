-- Pure, framework-free coordinator for the single-user credential: storage
-- (delegated to the injected settings store), a getter the API client reads per
-- request, and 401 detection to route back to the credential prompt. on_prompt is
-- the credential-entry launcher (ui/credential_prompt.lua at runtime).

local Auth = {}
Auth.__index = Auth

function Auth.new(opts)
    return setmetatable({
        settings = opts.settings,
        on_prompt = opts.on_prompt,
    }, Auth)
end

function Auth:getCredential()
    return self.settings:getCredential()
end

function Auth:hasCredential()
    local credential = self:getCredential()
    return credential ~= nil and credential ~= ""
end

function Auth:setCredential(credential)
    self.settings:setCredential(credential)
end

-- Read on every request, so a credential entered mid-session attaches to later
-- calls without rebuilding the client.
function Auth:credentialGetter()
    return function()
        return self:getCredential()
    end
end

function Auth:isUnauthorized(err)
    return err ~= nil and err.kind == "http" and err.status == 401
end

-- Re-prompts on a 401 and returns true; returns false for anything else, so callers
-- can tell a re-auth apart from an error to surface.
function Auth:handleError(err)
    if self:isUnauthorized(err) then
        self.on_prompt()
        return true
    end
    return false
end

return Auth
