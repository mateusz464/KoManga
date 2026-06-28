-- KRP-403 — [TEST] Manga details & chapter list (logic).
--
-- Defines the contract for state/details.lua (implemented alongside the UI in
-- KRP-404): the pure state behind a manga's details view — its metadata, the
-- ordered chapter list, the follow/unfollow action, the reading direction
-- (RTL/LTR), and the last-read position. It is framework-free so busted drives it
-- with no KOReader loaded (CLAUDE.md §4 — logic tickets are strict TDD; §5 —
-- state/ is pure), reaching the network only through an injected ApiClient, mocked
-- HERE at the api/ boundary via FakeApi (CLAUDE.md §5 — state never touches
-- socket.http).
--
-- It owns four jobs (the KRP-403 acceptance criteria):
--   1. Load details: manga metadata, the chapter list IN ORDER, reading direction.
--   2. Load the last-read position (resume point); a "never read yet" 404 is the
--      empty state, NOT an error; expose which chapter is the last-read one.
--   3. Load whether the manga is followed (membership of the library list).
--   4. Follow / unfollow: toggle followed state and call the API; on error leave
--      the state intact so a retry is possible.
--
-- Each job mirrors state/browse.lua's split into a pure `fetch*` (the blocking API
-- call, returning api/client.lua's (data, err)) and an `apply*` (mutates state);
-- the synchronous load/follow/unfollow methods the specs drive are their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-404).
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the shared API contract (RFC §6/§7, /api/manga/:id):
--   getManga(id) -> ({ manga = {id,sourceId,title,...},
--                      chapters = { {id,name,chapterNumber,...}, ... } (ordered),
--                      readingDirection = "rtl"|"ltr" }, nil) | (nil, err)
--   getProgress(id) -> ({ mangaId,chapterId,page,updatedAt }, nil) | (nil, err)
--                      -- a 404 means "no progress yet", not a hard error.
--   listLibrary() -> ({ {mangaId,addedAt}, ... }, nil) | (nil, err)
--   follow(id,addedAt) -> ({ mangaId,addedAt }, nil) | (nil, err)
--   unfollow(id) -> ({ mangaId }, nil) | (nil, err)
-- Errors are the typed table api/client.lua maps (KRP-301): { kind, status?, ... }.

local Details = require("state.details")
local FakeApi = require("spec.support.fake_api")

local MANGA_ID = "m7"

-- A details payload. A builder, not a constant, so every call hands back a FRESH
-- table — an impl that mutates the returned chapter list can't corrupt a value a
-- later test reuses (test isolation). Chapters are given in ascending order, as
-- the API serves them (manga-service sorts by chapterNumber).
local function DETAILS()
    return {
        manga = { id = MANGA_ID, sourceId = "mangadex", title = "Berserk" },
        chapters = {
            { id = "c1", name = "Chapter 1", chapterNumber = 1 },
            { id = "c2", name = "Chapter 2", chapterNumber = 2 },
            { id = "c3", name = "Chapter 3", chapterNumber = 3 },
        },
        readingDirection = "rtl",
    }
end

local function PROGRESS()
    return { mangaId = MANGA_ID, chapterId = "c2", page = 4, updatedAt = 1700 }
end

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local NOT_FOUND = { kind = "http", status = 404, code = "NOT_FOUND" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

-- Collect chapter ids in list order, so order-preservation is assertable.
local function ids(list)
    local out = {}
    for _, c in ipairs(list) do
        out[#out + 1] = c.id
    end
    return out
end

describe("manga details state", function()
    describe("details & chapter list", function()
        it("loads the manga metadata, chapters and reading direction", function()
            local api = FakeApi.new{ getManga = DETAILS }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:load()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("Berserk", details:getManga().title)
            assert.are.equal("rtl", details:getReadingDirection())
            -- Requested the manga we were constructed for.
            assert.are.equal(1, #api.calls)
            assert.are.equal("getManga", api.calls[1].method)
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
        end)

        it("keeps the chapter list in the order the API served it", function()
            local api = FakeApi.new{ getManga = DETAILS }
            local details = Details.new(api, MANGA_ID)

            details:load()

            assert.are.same({ "c1", "c2", "c3" }, ids(details:getChapters()))
        end)

        it("surfaces a details error and leaves chapters empty", function()
            local api = FakeApi.new{ getManga = function() return nil, HTTP_ERROR end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:load()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, details:getError())
            assert.are.same({}, details:getChapters())
            assert.is_nil(details:getManga())
        end)

        it("clears a prior error on a successful reload", function()
            local boom = true
            local api = FakeApi.new{
                getManga = function()
                    if boom then return nil, HTTP_ERROR end
                    return DETAILS()
                end,
            }
            local details = Details.new(api, MANGA_ID)

            details:load()
            assert.are.same(HTTP_ERROR, details:getError())

            boom = false
            details:load()
            assert.is_nil(details:getError())
            assert.are.same({ "c1", "c2", "c3" }, ids(details:getChapters()))
        end)
    end)

    describe("last-read position", function()
        it("loads the last-read chapter and page", function()
            local api = FakeApi.new{ getProgress = PROGRESS }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:loadProgress()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.equal("c2", details:getLastReadChapterId())
            assert.are.equal(4, details:getLastReadPage())
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
        end)

        it("indicates which chapter is the last-read one", function()
            local api = FakeApi.new{ getManga = DETAILS, getProgress = PROGRESS }
            local details = Details.new(api, MANGA_ID)

            details:load()
            details:loadProgress()

            assert.is_false(details:isLastRead("c1"))
            assert.is_true(details:isLastRead("c2"))
            assert.is_false(details:isLastRead("c3"))
        end)

        it("treats a 404 as 'never read yet', not an error", function()
            local api = FakeApi.new{ getProgress = function() return nil, NOT_FOUND end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:loadProgress()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_nil(details:getLastReadChapterId())
            assert.is_nil(details:getError())
            assert.is_false(details:isLastRead("c2"))
        end)

        it("surfaces a non-404 progress error", function()
            local api = FakeApi.new{ getProgress = function() return nil, TRANSPORT_ERROR end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:loadProgress()

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, details:getError())
            assert.is_nil(details:getLastReadChapterId())
        end)
    end)

    describe("follow state", function()
        it("reports followed when the manga is in the library", function()
            local api = FakeApi.new{
                listLibrary = { { mangaId = "other", addedAt = 1 }, { mangaId = MANGA_ID, addedAt = 2 } },
            }
            local details = Details.new(api, MANGA_ID)

            local ok = details:loadFollowState()

            assert.is_true(ok)
            assert.is_true(details:isFollowed())
            assert.are.equal("listLibrary", api.calls[1].method)
        end)

        it("reports not-followed when the manga is absent from the library", function()
            local api = FakeApi.new{ listLibrary = { { mangaId = "other", addedAt = 1 } } }
            local details = Details.new(api, MANGA_ID)

            local ok = details:loadFollowState()

            assert.is_true(ok)
            assert.is_false(details:isFollowed())
        end)

        it("defaults to not-followed before the library is loaded", function()
            local api = FakeApi.new{}
            local details = Details.new(api, MANGA_ID)

            assert.is_false(details:isFollowed())
        end)

        it("surfaces a library-load error and leaves follow state unchanged", function()
            local api = FakeApi.new{ listLibrary = function() return nil, HTTP_ERROR end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:loadFollowState()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.is_false(details:isFollowed())
        end)
    end)

    describe("follow / unfollow", function()
        it("follow calls the API and flips state to followed", function()
            local api = FakeApi.new{ follow = function() return { mangaId = MANGA_ID, addedAt = 1700 } end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:follow(1700)

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_true(details:isFollowed())
            assert.are.equal("follow", api.calls[1].method)
            assert.are.equal(MANGA_ID, api.calls[1].args[1])
            assert.are.equal(1700, api.calls[1].args[2])
        end)

        it("unfollow calls the API and flips state to not-followed", function()
            local api = FakeApi.new{
                listLibrary = { { mangaId = MANGA_ID, addedAt = 2 } },
                unfollow = function() return { mangaId = MANGA_ID } end,
            }
            local details = Details.new(api, MANGA_ID)
            details:loadFollowState()
            assert.is_true(details:isFollowed())

            local ok, err = details:unfollow()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_false(details:isFollowed())
            assert.are.equal("unfollow", api.calls[2].method)
            assert.are.equal(MANGA_ID, api.calls[2].args[1])
        end)

        it("keeps state unchanged when follow fails", function()
            local api = FakeApi.new{ follow = function() return nil, TRANSPORT_ERROR end }
            local details = Details.new(api, MANGA_ID)

            local ok, err = details:follow(1700)

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, details:getError())
            -- Not followed: the write failed, so the toggle must not have flipped.
            assert.is_false(details:isFollowed())
        end)

        it("keeps state followed when unfollow fails", function()
            local api = FakeApi.new{
                listLibrary = { { mangaId = MANGA_ID, addedAt = 2 } },
                unfollow = function() return nil, TRANSPORT_ERROR end,
            }
            local details = Details.new(api, MANGA_ID)
            details:loadFollowState()

            local ok, err = details:unfollow()

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.is_true(details:isFollowed())
        end)
    end)
end)
