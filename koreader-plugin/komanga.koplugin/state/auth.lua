-- KRP-304 — Auth flow (impl). The pure, framework-free coordinator for the
-- single-user credential (RFC §6/§7, CLAUDE.md §5/§6): it owns credential
-- storage (delegated to a settings-backed store, so it survives a restart),
-- hands the API client a getter that reads the credential PER request, and
-- detects a 401 to route back to the credential-entry prompt.
--
-- Collaborators are injected (CLAUDE.md §9): `settings` (a Settings instance for
-- persistence) and `on_prompt` (the credential-entry launcher — an InputDialog in
-- the runtime, see ui/credential_prompt.lua; a recorder in specs). No KOReader and
-- no HTTP are touched here, so busted can test it in isolation (CLAUDE.md §4).

local Auth = {}
Auth.__index = Auth

-- opts: { settings = <Settings>, on_prompt = <function> }
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

-- A getter the API client reads on EVERY request (KRP-301), so a credential
-- entered mid-session attaches to later calls without rebuilding the client.
function Auth:credentialGetter()
    return function()
        return self:getCredential()
    end
end

-- Pure predicate: true only for the 401 shape api/client.lua maps (KRP-301),
-- never for other http statuses, transport, or decode errors (or no error).
function Auth:isUnauthorized(err)
    return err ~= nil and err.kind == "http" and err.status == 401
end

-- Route a call's error back to credential entry when (and only when) it is a 401.
-- Returns true if it handled (re-prompted), false otherwise — so callers can tell
-- a re-auth apart from an error to surface.
function Auth:handleError(err)
    if self:isUnauthorized(err) then
        self.on_prompt()
        return true
    end
    return false
end

return Auth
