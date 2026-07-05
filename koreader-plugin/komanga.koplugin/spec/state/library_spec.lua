-- KRP-603 — [TEST] Library / home view (logic).
--
-- Defines the contract for state/library.lua (implemented alongside the UI in
-- KRP-604): the pure state behind the library / home view — the followed-manga
-- list, the per-manga "continue reading" (last-read) shortcut, and the list of
-- downloaded chapters. It is framework-free so busted drives it with no KOReader
-- loaded (CLAUDE.md §4 — logic tickets are strict TDD; §5 — state/ is pure),
-- reaching the network only through an injected ApiClient, mocked HERE at the
-- api/ boundary via FakeApi (CLAUDE.md §5 — state never touches socket.http).
--
-- It owns three jobs (the KRP-603 acceptance criteria):
--   1. Followed manga: load the library list (the manga the user follows), IN THE
--      ORDER the API serves it (added_at ASC); an empty library is the empty
--      state, NOT an error.
--   2. Continue reading: for a followed manga, resolve its last-read position into
--      a jump target the reader can open. A "never read yet" 404 is the empty
--      state (no target), NOT an error. The reader/progress-sync (KRP-602) seeks
--      the actual page on open, so the target only needs the chapter to open; the
--      raw last-read page is carried for the "last-read render".
--   3. Downloaded chapters: load the downloads list and expose which are OPENABLE
--      — only a `completed` build can be opened; `pending`/`failed` rows are not.
--
-- Each list-load mirrors state/browse.lua's split into a pure `fetch*` (the
-- blocking API call, returning api/client.lua's (data, err)) and an `apply*` (that
-- mutates this state); the synchronous load methods the specs drive are their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-604). The
-- continue-reading resolver returns its target instead of mutating (like
-- state/progress.lua's applyResume) because it is a per-manga, per-row lookup, not
-- shared list state.
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the shared API contract (RFC §6/§7):
--   listLibrary()   -> ({ {mangaId,addedAt}, ... } (added_at ASC), nil) | (nil, err)
--   getProgress(id) -> ({ mangaId,chapterId,page,updatedAt }, nil) | (nil, err)
--                      -- a 404 means "never read yet", not a hard error.
--   listDownloads() -> ({ {chapterId,mangaId,cbzPath,status,createdAt}, ... }, nil)
--                      | (nil, err) -- status ∈ "pending"|"completed"|"failed".
-- Errors are the typed table api/client.lua maps (KRP-301): { kind, status?, ... }.
--
-- NOTE: each library entry carries a display `title` captured at follow time
-- (API-908/KRP-605), alongside its mangaId. The title is optional — a row followed
-- before API-908 omits it — so `entryTitle` falls back to the mangaId. This is the
-- denormalised title on the entry, not a per-row getManga fan-out (CLAUDE.md §6/§8).

local Library = require("state.library")
local FakeApi = require("spec.support.fake_api")

-- Builders (not constants) so every call hands back a FRESH table — an impl that
-- mutates a returned list can't corrupt a value a later test reuses.

-- The followed-manga list, in the added_at ASC order the API serves. Each entry
-- carries a display title (API-908), except m1 — a pre-title row exercising the
-- mangaId fallback.
local function LIBRARY()
    return {
        { mangaId = "m3", addedAt = 1, title = "Berserk" },
        { mangaId = "m7", addedAt = 2, title = "Vinland Saga" },
        { mangaId = "m1", addedAt = 3 },
    }
end

local function PROGRESS()
    return { mangaId = "m7", chapterId = "c2", page = 4, updatedAt = 1700 }
end

-- A downloads list mixing every status, so "openable = completed only" is
-- assertable and order preservation is visible.
local function DOWNLOADS()
    return {
        { chapterId = "c1", mangaId = "m7", cbzPath = "/d/c1.cbz", status = "completed", createdAt = 10 },
        { chapterId = "c2", mangaId = "m7", cbzPath = "/d/c2.cbz", status = "pending",   createdAt = 20 },
        { chapterId = "c9", mangaId = "m3", cbzPath = "/d/c9.cbz", status = "completed", createdAt = 30 },
        { chapterId = "c8", mangaId = "m1", cbzPath = "",          status = "failed",    createdAt = 40 },
    }
end

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local NOT_FOUND = { kind = "http", status = 404, code = "NOT_FOUND" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

-- Collect an id field in list order, so order-preservation / filtering is assertable.
local function pluck(list, field)
    local out = {}
    for _, item in ipairs(list) do
        out[#out + 1] = item[field]
    end
    return out
end

describe("library / home view state", function()
    describe("followed manga", function()
        it("loads the followed list in the order the API serves it", function()
            local api = FakeApi.new{ listLibrary = LIBRARY }
            local library = Library.new(api)

            local ok, err = library:loadLibrary()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same({ "m3", "m7", "m1" }, pluck(library:getEntries(), "mangaId"))
            assert.are.equal(1, #api.calls)
            assert.are.equal("listLibrary", api.calls[1].method)
        end)

        it("carries the display title on each followed entry", function()
            local api = FakeApi.new{ listLibrary = LIBRARY }
            local library = Library.new(api)

            library:loadLibrary()

            -- The title captured at follow time (API-908) is carried through; a
            -- pre-title row (m1) simply omits it.
            assert.are.same({ "Berserk", "Vinland Saga" }, pluck(library:getEntries(), "title"))
        end)

        it("labels a followed row by title, falling back to the mangaId", function()
            assert.are.equal("Berserk", Library.entryTitle({ mangaId = "m3", title = "Berserk" }))
            -- Absent, empty, or non-string title → fall back to the raw mangaId.
            assert.are.equal("m1", Library.entryTitle({ mangaId = "m1" }))
            assert.are.equal("m1", Library.entryTitle({ mangaId = "m1", title = "" }))
        end)

        it("treats an empty library as the empty state, not an error", function()
            local api = FakeApi.new{ listLibrary = function() return {} end }
            local library = Library.new(api)

            local ok, err = library:loadLibrary()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.is_true(library:isEmpty())
            assert.is_nil(library:getError())
            assert.are.same({}, library:getEntries())
        end)

        it("is not empty before a load, nor when entries are present", function()
            local api = FakeApi.new{ listLibrary = LIBRARY }
            local library = Library.new(api)

            -- Before any load: no successful empty result yet, so not the empty state.
            assert.is_false(library:isEmpty())

            library:loadLibrary()
            assert.is_false(library:isEmpty())
        end)

        it("surfaces a library error and leaves prior entries intact", function()
            local boom = false
            local api = FakeApi.new{
                listLibrary = function()
                    if boom then return nil, HTTP_ERROR end
                    return LIBRARY()
                end,
            }
            local library = Library.new(api)
            library:loadLibrary()

            boom = true
            local ok, err = library:loadLibrary()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, library:getError())
            -- The prior list is kept so the view can keep showing it on a refresh error.
            assert.are.same({ "m3", "m7", "m1" }, pluck(library:getEntries(), "mangaId"))
            -- An outstanding error is not the empty state.
            assert.is_false(library:isEmpty())
        end)

        it("clears a prior error on a successful reload", function()
            local boom = true
            local api = FakeApi.new{
                listLibrary = function()
                    if boom then return nil, HTTP_ERROR end
                    return LIBRARY()
                end,
            }
            local library = Library.new(api)

            library:loadLibrary()
            assert.are.same(HTTP_ERROR, library:getError())

            boom = false
            library:loadLibrary()
            assert.is_nil(library:getError())
            assert.are.same({ "m3", "m7", "m1" }, pluck(library:getEntries(), "mangaId"))
        end)
    end)

    describe("continue reading", function()
        it("resolves the last-read position into a jump target", function()
            local api = FakeApi.new{ getProgress = PROGRESS }
            local library = Library.new(api)

            local target, err = library:continueReading("m7")

            assert.is_nil(err)
            assert.is_table(target)
            -- What the reader needs to jump in: which manga, which chapter to open,
            -- and the raw last-read page for the "last-read render".
            assert.are.equal("m7", target.mangaId)
            assert.are.equal("c2", target.chapterId)
            assert.are.equal(4, target.page)
            -- Fetched progress for exactly the manga asked about.
            assert.are.equal("getProgress", api.calls[1].method)
            assert.are.equal("m7", api.calls[1].args[1])
        end)

        it("treats a never-read 404 as no target, not an error", function()
            local api = FakeApi.new{ getProgress = function() return nil, NOT_FOUND end }
            local library = Library.new(api)

            local target, err = library:continueReading("m7")

            assert.is_nil(target)
            assert.is_nil(err)
        end)

        it("surfaces a non-404 progress error", function()
            local api = FakeApi.new{ getProgress = function() return nil, TRANSPORT_ERROR end }
            local library = Library.new(api)

            local target, err = library:continueReading("m7")

            assert.is_nil(target)
            assert.are.same(TRANSPORT_ERROR, err)
        end)

        it("does not touch the shared list error (per-row lookup)", function()
            local api = FakeApi.new{
                listLibrary = LIBRARY,
                getProgress = function() return nil, TRANSPORT_ERROR end,
            }
            local library = Library.new(api)
            library:loadLibrary()

            library:continueReading("m7")

            -- A per-manga continue lookup failing must not clobber the list state.
            assert.is_nil(library:getError())
        end)
    end)

    describe("downloaded chapters", function()
        it("loads the downloads list in the order the API serves it", function()
            local api = FakeApi.new{ listDownloads = DOWNLOADS }
            local library = Library.new(api)

            local ok, err = library:loadDownloads()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same({ "c1", "c2", "c9", "c8" }, pluck(library:getDownloads(), "chapterId"))
            assert.are.equal("listDownloads", api.calls[1].method)
        end)

        it("exposes only completed downloads as openable, in order", function()
            local api = FakeApi.new{ listDownloads = DOWNLOADS }
            local library = Library.new(api)
            library:loadDownloads()

            assert.are.same({ "c1", "c9" }, pluck(library:getOpenableDownloads(), "chapterId"))
        end)

        it("classifies openability by build status", function()
            assert.is_true(Library.isOpenable({ status = "completed" }))
            assert.is_false(Library.isOpenable({ status = "pending" }))
            assert.is_false(Library.isOpenable({ status = "failed" }))
        end)

        it("surfaces a downloads error and leaves prior downloads intact", function()
            local boom = false
            local api = FakeApi.new{
                listDownloads = function()
                    if boom then return nil, HTTP_ERROR end
                    return DOWNLOADS()
                end,
            }
            local library = Library.new(api)
            library:loadDownloads()

            boom = true
            local ok, err = library:loadDownloads()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, library:getError())
            assert.are.same({ "c1", "c2", "c9", "c8" }, pluck(library:getDownloads(), "chapterId"))
        end)

        it("starts with no downloads before a load", function()
            local api = FakeApi.new{}
            local library = Library.new(api)

            assert.are.same({}, library:getDownloads())
            assert.are.same({}, library:getOpenableDownloads())
        end)
    end)
end)
