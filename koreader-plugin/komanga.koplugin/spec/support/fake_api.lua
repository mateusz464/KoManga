-- KRP-103 — fake API client for specs.
--
-- The plugin's network boundary is api/ (CLAUDE.md §5): state/ and ui/ modules
-- receive an ApiClient and never call socket.http themselves. Logic specs
-- therefore mock at THIS boundary — inject a fake client — instead of stubbing
-- the HTTP layer. (Only the API-client spec itself, KRP-301, drops to HTTP.)
--
-- Usage:
--   local FakeApi = require("spec.support.fake_api")
--   local api = FakeApi.new{
--       search = { data = { { id = 1, title = "Berserk" } } },         -- canned value
--       getManga = function(id) return { data = { id = id } } end,     -- or a function
--   }
--   local results = SomeState.new(api):search("berserk")  -- inject the fake
--   assert.are.equal(1, #api.calls)                       -- and inspect calls
--   assert.are.equal("search", api.calls[1].method)
--
-- Any method name works: unconfigured methods record the call and return nil,
-- so a spec can assert a call happened without pinning a response.

local FakeApi = {}

-- responses: map of method-name -> canned return value, or -> function(...).
function FakeApi.new(responses)
    responses = responses or {}
    local calls = {}
    local client = { calls = calls }

    return setmetatable(client, {
        __index = function(_, method)
            return function(_self, ...)
                table.insert(calls, { method = method, args = { ... } })
                local r = responses[method]
                if type(r) == "function" then
                    return r(...)
                end
                return r
            end
        end,
    })
end

return FakeApi
