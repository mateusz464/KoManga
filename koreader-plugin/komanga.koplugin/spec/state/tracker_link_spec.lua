-- KOM-148 - [TEST] Account-linking flow state (poll loop).
--
-- Defines the contract for state/tracker_link.lua: the pure state coordinator
-- behind AniList account linking. It is framework-free so busted drives it with
-- no KOReader loaded, and it reaches the network only through an injected
-- ApiClient mocked at the api/ boundary (CLAUDE.md sections 4 and 5).
--
-- The UI is expected to run fetch* methods through net.lua, then call apply*
-- parent-side. The driven clock here pins bounded polling without real timers:
-- no poll is scheduled before start, exactly one next poll is scheduled while
-- pending, and terminal/cancelled states schedule no further work.

local TrackerLink = require("state.tracker_link")
local Settings = require("settings")
local FakeApi = require("spec.support.fake_api")
local FakeStore = require("spec.support.fake_store")

local HTTP_ERROR = { kind = "http", status = 502, code = "BAD_GATEWAY" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

local function fake_clock()
    local clock = { scheduled = {}, cancelled = {} }

    function clock:after(seconds, callback)
        local handle = { seconds = seconds, callback = callback, cancelled = false }
        self.scheduled[#self.scheduled + 1] = handle
        return handle
    end

    function clock:cancel(handle)
        handle.cancelled = true
        self.cancelled[#self.cancelled + 1] = handle
    end

    function clock:run_next()
        local handle = table.remove(self.scheduled, 1)
        if handle and not handle.cancelled then
            handle.callback()
        end
        return handle
    end

    return clock
end

local function make(opts)
    opts = opts or {}
    local api = FakeApi.new(opts.api or {})
    local clock = opts.clock or fake_clock()
    local settings = Settings.new(opts.store or FakeStore.new())
    local link = TrackerLink.new(api, {
        clock = clock,
        poll_interval_seconds = opts.poll_interval_seconds or 3,
        settings = settings,
    })
    return link, api, clock, settings
end

describe("tracker account-link state", function()
    describe("start", function()
        it("starts a link session and holds the session id plus QR URL", function()
            local link, api, clock = make{
                api = {
                    linkStart = {
                        sessionId = "link-123",
                        qrUrl = "/api/tracker/anilist/link/link-123/qr.png",
                    },
                },
            }

            local ok, err = link:start()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("pending", link:getStatus())
            assert.are.equal("link-123", link:getSessionId())
            assert.are.equal("/api/tracker/anilist/link/link-123/qr.png", link:getQrUrl())
            assert.is_nil(link:getError())
            assert.are.equal(1, #api.calls)
            assert.are.equal("linkStart", api.calls[1].method)
            assert.are.equal(1, #clock.scheduled)
            assert.are.equal(3, clock.scheduled[1].seconds)
        end)

        it("surfaces a start error and does not schedule polling", function()
            local link, _, clock = make{
                api = {
                    linkStart = function()
                        return nil, HTTP_ERROR
                    end,
                },
            }

            local ok, err = link:start()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.equal("idle", link:getStatus())
            assert.are.same(HTTP_ERROR, link:getError())
            assert.are.equal(0, #clock.scheduled)
        end)

        it("restarts cleanly after an expired session", function()
            local starts = 0
            local link = make{
                api = {
                    linkStart = function()
                        starts = starts + 1
                        return {
                            sessionId = "link-" .. starts,
                            qrUrl = "/qr/" .. starts,
                        }
                    end,
                    linkStatus = { status = "expired" },
                },
            }

            link:start()
            link:applyStatus(link:fetchStatus())
            assert.are.equal("expired", link:getStatus())

            local ok = link:start()

            assert.is_true(ok)
            assert.are.equal("pending", link:getStatus())
            assert.are.equal("link-2", link:getSessionId())
            assert.are.equal("/qr/2", link:getQrUrl())
        end)
    end)

    describe("fetch/apply split", function()
        it("fetches status through api:linkStatus without mutating state", function()
            local link, api = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                    linkStatus = { status = "linked" },
                },
            }
            link:start()

            local data, err = link:fetchStatus()

            assert.are.same({ status = "linked" }, data)
            assert.is_nil(err)
            assert.are.equal("pending", link:getStatus())
            assert.are.equal(2, #api.calls)
            assert.are.equal("linkStatus", api.calls[2].method)
            assert.are.equal("link-123", api.calls[2].args[1])
        end)

        it("applies linked as a terminal success and stops polling", function()
            local link, _, clock, settings = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                },
            }
            link:start()
            local scheduled = clock.scheduled[1]

            local ok, err = link:applyStatus({ status = "linked", account = { username = "matt" } })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("linked", link:getStatus())
            assert.are.same({ username = "matt" }, link:getAccount())
            assert.is_nil(link:getError())
            assert.is_true(settings:isTrackerLinked())
            assert.is_true(scheduled.cancelled)
            assert.are.equal(1, #clock.scheduled)
        end)

        it("drops a blank legacy username so the UI falls back to generic wording", function()
            local link = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                },
            }
            link:start()

            link:applyStatus({
                status = "linked",
                account = { anilistUserId = "12345", username = "" },
            })

            assert.are.equal("linked", link:getStatus())
            assert.are.same({ anilistUserId = "12345" }, link:getAccount())
        end)

        it("applies expired as a terminal restartable state and stops polling", function()
            local link, _, clock = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                },
            }
            link:start()
            local scheduled = clock.scheduled[1]

            local ok = link:applyStatus({ status = "expired" })

            assert.is_true(ok)
            assert.are.equal("expired", link:getStatus())
            assert.is_true(link:canRestart())
            assert.is_true(scheduled.cancelled)
            assert.are.equal(1, #clock.scheduled)
        end)

        it("keeps polling after a transient status error", function()
            local link, _, clock = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                },
            }
            link:start()

            local ok, err = link:applyStatus(nil, TRANSPORT_ERROR)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.equal("pending", link:getStatus())
            assert.are.same(TRANSPORT_ERROR, link:getError())
            assert.are.equal(2, #clock.scheduled)
            assert.are.equal(3, clock.scheduled[2].seconds)
        end)
    end)

    describe("bounded polling", function()
        it("does not poll before a session starts", function()
            local link, _, clock = make()

            local data, err = link:fetchStatus()

            assert.is_nil(data)
            assert.are.equal("idle", err.kind)
            assert.are.equal(0, #clock.scheduled)
        end)

        it("runs one poll per scheduled clock tick while pending", function()
            local statuses = {
                { status = "pending" },
                { status = "linked" },
            }
            local link, api, clock = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                    linkStatus = function()
                        return table.remove(statuses, 1)
                    end,
                },
            }

            link:start()
            clock:run_next()

            assert.are.equal("pending", link:getStatus())
            assert.are.equal(2, #api.calls)
            assert.are.equal(1, #clock.scheduled)

            clock:run_next()

            assert.are.equal("linked", link:getStatus())
            assert.are.equal(3, #api.calls)
            assert.are.equal(0, #clock.scheduled)
        end)

        it("cancels polling and ignores later results", function()
            local link, _, clock = make{
                api = {
                    linkStart = { sessionId = "link-123", qrUrl = "/qr" },
                },
            }
            link:start()
            local scheduled = clock.scheduled[1]

            link:cancel()
            local ok = link:applyStatus({ status = "linked" })

            assert.is_false(ok)
            assert.are.equal("cancelled", link:getStatus())
            assert.is_true(scheduled.cancelled)
            assert.are.equal(1, #clock.scheduled)
            assert.is_nil(link:getAccount())
        end)
    end)
end)
