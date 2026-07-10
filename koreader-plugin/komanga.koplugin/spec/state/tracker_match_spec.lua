-- KOM-150 - [TEST] Match / tracking-management state.
--
-- Defines the contract for state/tracker_match.lua: the pure per-manga state
-- behind AniList match management and the details-view tracking status line. It
-- is framework-free so busted drives it with no KOReader loaded, and it reaches
-- the network only through an injected ApiClient mocked at the api/ boundary
-- (CLAUDE.md sections 4 and 5).
--
-- Every operation follows the fetch/apply split (net.lua runs the fetch in a
-- forked subprocess that cannot mutate this table; the UI applies the result
-- parent-side): fetch* performs the blocking API call and never mutates state;
-- apply* mutates. Mutations flip ONLY on success — an apply with an error keeps
-- the prior state (and the held selection) intact so the same action can simply
-- be retried.
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the API's tracking-service (RFC section 6):
--   trackerCandidates(mangaId) -> ({ mangaId, candidates = { { mediaId, title,
--       alternateTitles, year?, format? }, ... } }, nil) | (nil, err)
--   setTrackerMatch(mangaId, mediaId) -> ({ mangaId, service, mediaId }, nil)
--   clearTrackerMatch(mangaId) -> ({ mangaId, service }, nil)  -- mediaId null
--   doNotTrack(mangaId) -> ({ mangaId, service, doNotTrack = true }, nil)
--   trackerStatus(mangaId) -> ({ mangaId, service,
--       state = "matched"|"unmatched"|"do_not_track"|"no_account",
--       account = { linked, needsRelink }, media = { mediaId }?,
--       lastSyncedChapter?, doNotTrack }, nil) | (nil, err)
-- Nullable JSON fields (media, lastSyncedChapter) may reach the impl as a
-- rapidjson null sentinel, which is truthy — derive matched-ness from the
-- `state` string, never from `media` truthiness.
-- Errors are the typed table api/client.lua maps: { kind, status?, ... }.

local TrackerMatch = require("state.tracker_match")
local FakeApi = require("spec.support.fake_api")

local MANGA_ID = "m7"

local HTTP_ERROR = { kind = "http", status = 502, code = "BAD_GATEWAY" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

-- Payload builders, not constants: every call hands back a FRESH table so an
-- impl that mutates a payload cannot corrupt a value a later test reuses.
local function CANDIDATES()
    return {
        mangaId = MANGA_ID,
        candidates = {
            {
                mediaId = "301",
                title = "Berserk",
                alternateTitles = { "Berserk (1989)" },
                year = 1989,
                format = "MANGA",
            },
            {
                mediaId = "302",
                title = "Berserk: The Prototype",
                alternateTitles = {},
                year = 1988,
                format = "ONE_SHOT",
            },
        },
    }
end

local function STATUS(overrides)
    local status = {
        mangaId = MANGA_ID,
        service = "anilist",
        state = "unmatched",
        account = { linked = true, needsRelink = false },
        media = nil,
        lastSyncedChapter = nil,
        doNotTrack = false,
    }
    for k, v in pairs(overrides or {}) do
        status[k] = v
    end
    return status
end

local function make(responses)
    local api = FakeApi.new(responses or {})
    return TrackerMatch.new(api, MANGA_ID), api
end

describe("tracker match state", function()
    describe("candidate load", function()
        it("starts with no candidates and no selection", function()
            local match = make()

            assert.are.same({}, match:getCandidates())
            assert.is_nil(match:getSelected())
        end)

        it("fetches candidates through api:trackerCandidates without mutating state", function()
            local match, api = make{ trackerCandidates = CANDIDATES }

            local data, err = match:fetchCandidates()

            assert.is_nil(err)
            assert.are.same(CANDIDATES(), data)
            assert.are.same({}, match:getCandidates())
            assert.are.equal(1, #api.calls)
            assert.are.equal("trackerCandidates", api.calls[1].method)
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
        end)

        it("applies loaded candidates", function()
            local match = make()

            local ok, err = match:applyCandidates(CANDIDATES())

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same(CANDIDATES().candidates, match:getCandidates())
            assert.is_nil(match:getError())
        end)

        it("keeps prior candidates on load error and surfaces the error", function()
            local match = make()
            match:applyCandidates(CANDIDATES())

            local ok, err = match:applyCandidates(nil, HTTP_ERROR)

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, match:getError())
            assert.are.same(CANDIDATES().candidates, match:getCandidates())
        end)

        it("holds a selected candidate by list index", function()
            local match = make()
            match:applyCandidates(CANDIDATES())

            local ok = match:selectCandidate(2)

            assert.is_true(ok)
            assert.are.same(CANDIDATES().candidates[2], match:getSelected())
        end)

        it("rejects a selection outside the candidate list", function()
            local match = make()
            match:applyCandidates(CANDIDATES())

            assert.is_false(match:selectCandidate(3))
            assert.is_false(match:selectCandidate(0))
            assert.is_nil(match:getSelected())
        end)

        it("clears the selection when candidates are reloaded", function()
            local match = make()
            match:applyCandidates(CANDIDATES())
            match:selectCandidate(1)

            match:applyCandidates(CANDIDATES())

            assert.is_nil(match:getSelected())
        end)
    end)

    describe("confirm match", function()
        local function matched(match)
            match:applyCandidates(CANDIDATES())
            match:selectCandidate(1)
            return match
        end

        it("refuses to fetch a confirm without a selection", function()
            local match, api = make()

            local data, err = match:fetchConfirm()

            assert.is_nil(data)
            assert.are.same({ kind = "no_selection" }, err)
            assert.are.equal(0, #api.calls)
        end)

        it("fetches the confirm through api:setTrackerMatch for the selected media", function()
            local match, api = matched(make{
                setTrackerMatch = { mangaId = MANGA_ID, service = "anilist", mediaId = "301" },
            })

            local data, err = match:fetchConfirm()

            assert.is_nil(err)
            assert.are.same({ mangaId = MANGA_ID, service = "anilist", mediaId = "301" }, data)
            assert.is_false(match:isMatched())
            assert.are.equal("setTrackerMatch", api.calls[#api.calls].method)
            assert.are.same({ MANGA_ID, "301" }, api.calls[#api.calls].args)
        end)

        it("flips to matched only on a successful confirm", function()
            local match = matched(make())

            local ok, err = match:applyConfirm({
                mangaId = MANGA_ID, service = "anilist", mediaId = "301",
            })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_true(match:isMatched())
            assert.are.equal("matched", match:getState())
            assert.are.equal("301", match:getMediaId())
            assert.is_nil(match:getError())
        end)

        it("stays unmatched on confirm error, keeps the selection, and is retryable", function()
            local match, api = matched(make{
                setTrackerMatch = { mangaId = MANGA_ID, service = "anilist", mediaId = "301" },
            })

            local ok, err = match:applyConfirm(nil, TRANSPORT_ERROR)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, match:getError())
            assert.is_false(match:isMatched())
            assert.are.same(CANDIDATES().candidates[1], match:getSelected())

            -- The retry: the same fetch/apply pair now succeeds.
            local data, fetch_err = match:fetchConfirm()
            assert.is_nil(fetch_err)
            assert.are.same({ MANGA_ID, "301" }, api.calls[#api.calls].args)
            assert.is_true(match:applyConfirm(data))
            assert.is_true(match:isMatched())
            assert.is_nil(match:getError())
        end)
    end)

    describe("do not track", function()
        it("fetches through api:doNotTrack without mutating state", function()
            local match, api = make{
                doNotTrack = { mangaId = MANGA_ID, service = "anilist", doNotTrack = true },
            }

            local data, err = match:fetchDoNotTrack()

            assert.is_nil(err)
            assert.are.same({ mangaId = MANGA_ID, service = "anilist", doNotTrack = true }, data)
            assert.are.not_equal("do_not_track", match:getState())
            assert.are.equal(1, #api.calls)
            assert.are.equal("doNotTrack", api.calls[1].method)
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
        end)

        it("flips to do_not_track only on success", function()
            local match = make()

            local ok, err = match:applyDoNotTrack({
                mangaId = MANGA_ID, service = "anilist", doNotTrack = true,
            })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("do_not_track", match:getState())
            assert.is_false(match:isMatched())
            assert.is_nil(match:getError())
        end)

        it("keeps the prior state on error and surfaces it", function()
            local match = make()
            match:applyStatus(STATUS{ state = "matched", media = { mediaId = "301" } })

            local ok, err = match:applyDoNotTrack(nil, HTTP_ERROR)

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, match:getError())
            assert.are.equal("matched", match:getState())
            assert.is_true(match:isMatched())
        end)
    end)

    describe("remove tracking", function()
        local function tracked(match)
            match:applyStatus(STATUS{
                state = "matched",
                media = { mediaId = "301" },
                lastSyncedChapter = 12,
            })
            return match
        end

        it("fetches through api:clearTrackerMatch without mutating state", function()
            local match, api = tracked(make{
                clearTrackerMatch = { mangaId = MANGA_ID, service = "anilist" },
            })

            local data, err = match:fetchClear()

            assert.is_nil(err)
            assert.are.same({ mangaId = MANGA_ID, service = "anilist" }, data)
            assert.is_true(match:isMatched())
            assert.are.equal("clearTrackerMatch", api.calls[#api.calls].method)
            assert.are.equal(MANGA_ID, api.calls[#api.calls].args[1])
        end)

        it("flips to unmatched only on success and drops the media", function()
            local match = tracked(make())

            local ok, err = match:applyClear({ mangaId = MANGA_ID, service = "anilist" })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("unmatched", match:getState())
            assert.is_false(match:isMatched())
            assert.is_nil(match:getMediaId())
            assert.is_nil(match:getError())
        end)

        it("stays matched on error and surfaces it", function()
            local match = tracked(make())

            local ok, err = match:applyClear(nil, TRANSPORT_ERROR)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, match:getError())
            assert.is_true(match:isMatched())
            assert.are.equal("301", match:getMediaId())
        end)
    end)

    describe("tracking status", function()
        it("fetches through api:trackerStatus without mutating state", function()
            local match, api = make{ trackerStatus = STATUS }

            local data, err = match:fetchStatus()

            assert.is_nil(err)
            assert.are.same(STATUS(), data)
            assert.is_nil(match:getState())
            assert.are.equal(1, #api.calls)
            assert.are.equal("trackerStatus", api.calls[1].method)
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
        end)

        it("applies a matched status with its synced chapter", function()
            local match = make()

            local ok, err = match:applyStatus(STATUS{
                state = "matched",
                media = { mediaId = "301" },
                lastSyncedChapter = 12,
            })

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("matched", match:getState())
            assert.is_true(match:isMatched())
            assert.are.equal("301", match:getMediaId())
            assert.are.equal(12, match:getLastSyncedChapter())
            assert.is_false(match:needsRelink())
        end)

        it("applies a re-link-needed status", function()
            local match = make()

            match:applyStatus(STATUS{
                state = "matched",
                account = { linked = true, needsRelink = true },
                media = { mediaId = "301" },
            })

            assert.is_true(match:isMatched())
            assert.is_true(match:needsRelink())
        end)

        it("keeps the prior status on error and surfaces it", function()
            local match = make()
            match:applyStatus(STATUS{
                state = "matched",
                media = { mediaId = "301" },
                lastSyncedChapter = 12,
            })

            local ok, err = match:applyStatus(nil, HTTP_ERROR)

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, match:getError())
            assert.are.equal("matched", match:getState())
            assert.are.equal(12, match:getLastSyncedChapter())
        end)
    end)

    describe("details status line", function()
        local function line(overrides)
            local match = make()
            match:applyStatus(STATUS(overrides))
            return match:statusLine()
        end

        it("shows nothing before a status is loaded or without a linked account", function()
            local match = make()
            assert.is_nil(match:statusLine())
            assert.is_nil(line{ state = "no_account", account = { linked = false, needsRelink = false } })
        end)

        it("maps an unmatched manga", function()
            assert.are.equal("Tracking: not matched", line{ state = "unmatched" })
        end)

        it("maps a do-not-track manga", function()
            assert.are.equal("Tracking: off", line{ state = "do_not_track", doNotTrack = true })
        end)

        it("maps a matched manga with its synced chapter", function()
            assert.are.equal("Tracking: AniList (synced ch. 12)", line{
                state = "matched",
                media = { mediaId = "301" },
                lastSyncedChapter = 12,
            })
        end)

        it("maps a matched manga that has not synced yet", function()
            assert.are.equal("Tracking: AniList (not synced yet)", line{
                state = "matched",
                media = { mediaId = "301" },
            })
        end)

        it("flags a matched manga whose account needs re-linking", function()
            assert.are.equal("Tracking: re-link needed", line{
                state = "matched",
                account = { linked = true, needsRelink = true },
                media = { mediaId = "301" },
                lastSyncedChapter = 12,
            })
        end)
    end)
end)
