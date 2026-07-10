-- KOM-157 - Manage AniList linked-account state.
--
-- Pure state behind the menu route and manage screen. The UI runs fetch* methods
-- through net.lua, then applies the result parent-side so the cached menu flag is
-- mutated outside the subprocess.

local TrackerAccount = require("state.tracker_account")
local Settings = require("settings")
local FakeApi = require("spec.support.fake_api")
local FakeStore = require("spec.support.fake_store")

local ACCOUNT = {
    anilistUserId = "100",
    username = "matt",
}
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

local function make(opts)
    opts = opts or {}
    local api = FakeApi.new(opts.api or {})
    local settings = Settings.new(opts.store or FakeStore.new())
    local account = TrackerAccount.new(api, settings)
    return account, api, settings
end

describe("tracker account state", function()
    describe("account fetch/apply", function()
        it("fetches the account through api:trackerAccount without mutating state", function()
            local account, api = make{
                api = {
                    trackerAccount = { linked = true, account = ACCOUNT },
                },
            }

            local data, err = account:fetchAccount()

            assert.is_nil(err)
            assert.are.same({ linked = true, account = ACCOUNT }, data)
            assert.is_false(account:isLinked())
            assert.are.equal(1, #api.calls)
            assert.are.equal("trackerAccount", api.calls[1].method)
        end)

        it("applies a linked account and updates the cached flag", function()
            local account, _, settings = make()

            local ok, err = account:applyAccount({ linked = true, account = ACCOUNT })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_true(account:isLinked())
            assert.are.same(ACCOUNT, account:getAccount())
            assert.is_true(settings:isTrackerLinked())
        end)

        it("drops a blank or unknown legacy username so the UI shows its fallback", function()
            local account = make()

            account:applyAccount({
                linked = true,
                account = { anilistUserId = "100", username = "" },
            })
            assert.are.same({ anilistUserId = "100" }, account:getAccount())

            account:applyAccount({
                linked = true,
                account = { anilistUserId = "100", username = "unknown" },
            })
            assert.are.same({ anilistUserId = "100" }, account:getAccount())
        end)

        it("applies an unlinked account and clears the cached flag", function()
            local account, _, settings = make{ store = FakeStore.new{ komanga_tracker_anilist_linked = true } }
            account:applyAccount({ linked = true, account = ACCOUNT })

            local ok = account:applyAccount({ linked = false })

            assert.is_true(ok)
            assert.is_false(account:isLinked())
            assert.is_nil(account:getAccount())
            assert.is_false(settings:isTrackerLinked())
        end)

        it("keeps the prior state on fetch error and surfaces the error", function()
            local account, _, settings = make()
            account:applyAccount({ linked = true, account = ACCOUNT })

            local ok, err = account:applyAccount(nil, TRANSPORT_ERROR)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, account:getError())
            assert.is_true(account:isLinked())
            assert.are.same(ACCOUNT, account:getAccount())
            assert.is_true(settings:isTrackerLinked())
        end)
    end)

    describe("unlink fetch/apply", function()
        it("fetches unlink through api:trackerUnlink without mutating state", function()
            local account, api = make{
                api = {
                    trackerUnlink = { linked = false },
                },
            }
            account:applyAccount({ linked = true, account = ACCOUNT })

            local data, err = account:fetchUnlink()

            assert.is_nil(err)
            assert.are.same({ linked = false }, data)
            assert.is_true(account:isLinked())
            assert.are.equal(1, #api.calls)
            assert.are.equal("trackerUnlink", api.calls[1].method)
        end)

        it("flips to unlinked only on successful unlink and clears the cache", function()
            local account, _, settings = make()
            account:applyAccount({ linked = true, account = ACCOUNT })

            local ok, err = account:applyUnlink({ linked = false })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_false(account:isLinked())
            assert.is_nil(account:getAccount())
            assert.is_false(settings:isTrackerLinked())
        end)

        it("stays linked on unlink error and surfaces the error", function()
            local account, _, settings = make()
            account:applyAccount({ linked = true, account = ACCOUNT })

            local ok, err = account:applyUnlink(nil, TRANSPORT_ERROR)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, account:getError())
            assert.is_true(account:isLinked())
            assert.are.same(ACCOUNT, account:getAccount())
            assert.is_true(settings:isTrackerLinked())
        end)
    end)

    describe("cached menu label", function()
        it("derives Link AniList from an unset or false cached flag", function()
            local _, _, settings = make()

            assert.is_false(TrackerAccount.cachedLinked(settings))
            assert.are.equal("Link AniList", TrackerAccount.menuLabel(settings))
            settings:setTrackerLinked(false)
            assert.are.equal("Link AniList", TrackerAccount.menuLabel(settings))
        end)

        it("derives Manage AniList from a true cached flag", function()
            local _, _, settings = make()

            settings:setTrackerLinked(true)

            assert.is_true(TrackerAccount.cachedLinked(settings))
            assert.are.equal("Manage AniList", TrackerAccount.menuLabel(settings))
        end)
    end)
end)
