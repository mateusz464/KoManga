-- KRP-202 — settings.lua: LuaSettings-backed credential + knob overrides.
-- Pure over an injected store (FakeStore), so no KOReader runtime is needed.
local Settings = require("settings")
local Config = require("config")
local FakeStore = require("spec.support.fake_store")

describe("settings", function()
    it("returns nil for an unset credential", function()
        local s = Settings.new(FakeStore.new())
        assert.is_nil(s:getCredential())
    end)

    it("stores the credential and flushes it for persistence", function()
        local store = FakeStore.new()
        local s = Settings.new(store)
        s:setCredential("secret-token")
        assert.are.equal("secret-token", s:getCredential())
        assert.is_true(store.flushes > 0)
    end)

    it("reads a credential persisted by a previous session", function()
        -- A store seeded from disk is what survives a KOReader restart.
        local store = FakeStore.new{ komanga_credential = "from-disk" }
        assert.are.equal("from-disk", Settings.new(store):getCredential())
    end)

    it("falls back to config defaults when knobs are unset", function()
        local s = Settings.new(FakeStore.new())
        assert.are.equal(Config.api_base_url, s:getApiBaseUrl())
        assert.are.equal(Config.prefetch_window, s:getPrefetchWindow())
        assert.are.equal(Config.progress_debounce_seconds, s:getProgressDebounceSeconds())
    end)

    it("prefers a persisted API base URL over the config default", function()
        local store = FakeStore.new()
        local s = Settings.new(store)
        s:setApiBaseUrl("https://my.tunnel.example")
        assert.are.equal("https://my.tunnel.example", s:getApiBaseUrl())
        assert.are_not.equal(Config.api_base_url, s:getApiBaseUrl())
    end)

    it("defaults the cached AniList linked flag to false", function()
        local s = Settings.new(FakeStore.new())
        assert.is_false(s:isTrackerLinked())
    end)

    it("persists the cached AniList linked flag", function()
        local store = FakeStore.new()
        local s = Settings.new(store)

        s:setTrackerLinked(true)

        assert.is_true(s:isTrackerLinked())
        assert.is_true(store.flushes > 0)
    end)
end)
