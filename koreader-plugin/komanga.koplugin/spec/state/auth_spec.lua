-- KRP-303 — [TEST] Auth flow (single credential).
--
-- Defines the contract for state/auth.lua (implemented in KRP-304): the pure
-- coordinator for the single-user credential (RFC §6/§7, CLAUDE.md §6). It owns
-- three jobs, all framework-free so busted can test them with no KOReader loaded
-- (CLAUDE.md §4 — logic tickets are strict TDD; §5 — state/ is pure):
--   1. Store/read the credential, settings-backed so it survives a restart.
--   2. Hand the API client a getter that reads the credential PER request
--      (never cached), so a credential set mid-session attaches to later calls.
--   3. Detect a 401 from any call and route back to the credential entry prompt.
--
-- Collaborators are injected (CLAUDE.md §9): a Settings instance (persistence)
-- and an `on_prompt` callback (the credential-entry launcher — InputDialog in the
-- impl, a recorder here). The actual InputDialog/LuaSettings wiring is KRP-304's
-- emulator/on-device concern; this spec pins only the testable logic.
--
-- A 401 is exactly the http error api/client.lua maps it to (KRP-301):
--   { kind = "http", status = 401, code = "UNAUTHORIZED" }.

local Auth = require("state.auth")
local Settings = require("settings")
local FakeStore = require("spec.support.fake_store")

-- Build an Auth over a real Settings backed by a FakeStore, plus a prompt
-- recorder. Returns the auth, the underlying store (to assert persistence /
-- simulate a restart) and the recorder ({ count } of prompt launches).
local function make(seed)
    local store = FakeStore.new(seed)
    local settings = Settings.new(store)
    local prompts = { count = 0 }
    local auth = Auth.new{
        settings = settings,
        on_prompt = function()
            prompts.count = prompts.count + 1
        end,
    }
    return auth, store, prompts
end

-- The 401 shape api/client.lua produces, plus the other error kinds it can return,
-- so we can pin that ONLY a 401 re-prompts.
local UNAUTHORIZED = { kind = "http", status = 401, code = "UNAUTHORIZED" }
local FORBIDDEN = { kind = "http", status = 403, code = "FORBIDDEN" }
local SERVER_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }
local DECODE_ERROR = { kind = "decode", message = "could not decode response body" }

describe("auth flow", function()
    describe("credential storage", function()
        it("reports no credential before one is entered", function()
            local auth = make()
            assert.is_false(auth:hasCredential())
            assert.is_nil(auth:getCredential())
        end)

        it("stores an entered credential and reports it present", function()
            local auth = make()
            auth:setCredential("secret-token")
            assert.is_true(auth:hasCredential())
            assert.are.equal("secret-token", auth:getCredential())
        end)

        it("persists the credential across a KOReader restart", function()
            -- A restart = the LuaSettings file is reopened. Model it as a new
            -- Auth/Settings over the SAME store the first session flushed to.
            local auth, store = make()
            auth:setCredential("survives-restart")
            assert.is_true(store.flushes > 0) -- written through, not just in memory

            local restarted = Auth.new{
                settings = Settings.new(store),
                on_prompt = function() end,
            }
            assert.is_true(restarted:hasCredential())
            assert.are.equal("survives-restart", restarted:getCredential())
        end)

        it("reads a credential persisted by a previous session on construction", function()
            local auth = make{ komanga_credential = "from-disk" }
            assert.is_true(auth:hasCredential())
            assert.are.equal("from-disk", auth:getCredential())
        end)
    end)

    describe("credential getter for the API client", function()
        it("returns a getter that yields the current credential", function()
            local auth = make{ komanga_credential = "token-a" }
            local getter = auth:credentialGetter()
            assert.are.equal("token-a", getter())
        end)

        it("reads the credential per call, reflecting a mid-session change", function()
            -- ApiClient calls get_credential() on every request (KRP-301), so a
            -- credential entered after the client was built must still attach.
            local auth = make()
            local getter = auth:credentialGetter()
            assert.is_nil(getter())
            auth:setCredential("entered-later")
            assert.are.equal("entered-later", getter())
        end)
    end)

    describe("401 routing back to credential entry", function()
        it("re-prompts on an Unauthorized error from any call", function()
            local auth, _, prompts = make{ komanga_credential = "stale" }
            local handled = auth:handleError(UNAUTHORIZED)
            assert.is_true(handled)
            assert.are.equal(1, prompts.count)
        end)

        it("identifies a 401 with a pure predicate", function()
            local auth = make()
            assert.is_true(auth:isUnauthorized(UNAUTHORIZED))
            assert.is_false(auth:isUnauthorized(FORBIDDEN))
            assert.is_false(auth:isUnauthorized(SERVER_ERROR))
            assert.is_false(auth:isUnauthorized(TRANSPORT_ERROR))
            assert.is_false(auth:isUnauthorized(DECODE_ERROR))
            assert.is_false(auth:isUnauthorized(nil))
        end)

        it("does not re-prompt on non-401 errors", function()
            for _, err in ipairs({ FORBIDDEN, SERVER_ERROR, TRANSPORT_ERROR, DECODE_ERROR }) do
                local auth, _, prompts = make{ komanga_credential = "ok" }
                local handled = auth:handleError(err)
                assert.is_false(handled)
                assert.are.equal(0, prompts.count)
            end
        end)

        it("does not re-prompt when a call succeeded (no error)", function()
            local auth, _, prompts = make{ komanga_credential = "ok" }
            assert.is_false(auth:handleError(nil))
            assert.are.equal(0, prompts.count)
        end)
    end)
end)
