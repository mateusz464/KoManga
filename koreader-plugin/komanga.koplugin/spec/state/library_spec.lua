-- KRP-603 — [TEST] Library / home view (logic).
-- KRP-805 — Downloaded section repointed at the device-local index (offline).
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
--   3. Downloaded chapters (KRP-805): read the DEVICE-LOCAL index (state/downloads.lua,
--      KRP-802) — NOT the API — so the list renders with wifi off. Every indexed
--      entry is a completed on-device CBZ (all openable), labelled by the manga title
--      + chapter number captured at download time (no network lookup).
--
-- The followed list mirrors state/browse.lua's split into a pure `fetchLibrary` (the
-- blocking API call, returning api/client.lua's (data, err)) and an `applyLibrary`
-- (that mutates this state); the synchronous `loadLibrary` the specs drive is their
-- composition. The split exists because net.lua runs the fetch in a forked
-- sub-process (KRP-305) which can't mutate this table across the fork, so the UI
-- runs the fetch through net and applies the result in the parent (KRP-604). The
-- Downloaded list needs none of this: it is a local read of the injected device index
-- (no network, no fork), so it is exposed directly. The continue-reading resolver
-- returns its target instead of mutating (like state/progress.lua's applyResume)
-- because it is a per-manga, per-row lookup, not shared list state.
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the shared API contract (RFC §6/§7):
--   listLibrary()   -> ({ {mangaId,addedAt}, ... } (added_at ASC), nil) | (nil, err)
--   getProgress(id) -> ({ mangaId,chapterId,page,updatedAt }, nil) | (nil, err)
--                      -- a 404 means "never read yet", not a hard error.
-- The Downloaded list is NOT a wire shape — it is the device index (KRP-802), each
-- entry { chapterId, mangaId, title, chapterNumber, direction, fileName, size,
-- createdAt }. Errors are the typed table api/client.lua maps (KRP-301).
--
-- NOTE: each library entry carries a display `title` captured at follow time
-- (API-908/KRP-605), alongside its mangaId. The title is optional — a row followed
-- before API-908 omits it — so `entryTitle` falls back to the mangaId. This is the
-- denormalised title on the entry, not a per-row getManga fan-out (CLAUDE.md §6/§8).

local Library = require("state.library")
local Downloads = require("state.downloads")
local FakeApi = require("spec.support.fake_api")
local FakeStore = require("spec.support.fake_store")

local DOWNLOAD_DIR = "/data/komanga/downloads"

-- Builders (not constants) so every call hands back a FRESH table — an impl that
-- mutates a returned list can't corrupt a value a later test reuses.

-- The followed-manga list, in the added_at ASC order the API serves. Each entry
-- carries a display title (API-908), except m1 — a pre-title row exercising the
-- mangaId fallback. Entries also carry the API's continue target (API-912/KRP-607):
-- m3 has a next chapter to read, m7 is caught up, m1 (an older-API row) omits both.
local function LIBRARY()
    return {
        { mangaId = "m3", addedAt = 1, title = "Berserk",
          nextChapter = { id = "c10", number = 41 }, caughtUp = false },
        { mangaId = "m7", addedAt = 2, title = "Vinland Saga",
          nextChapter = nil, caughtUp = true },
        { mangaId = "m1", addedAt = 3 },
    }
end

local function PROGRESS()
    return { mangaId = "m7", chapterId = "c2", page = 4, updatedAt = 1700 }
end

-- A device-local download index entry (KRP-802 shape); `over` patches fields. fileName
-- is derived from the chapterId, exactly as the coordinator records it (KRP-803).
local function dl_entry(over)
    over = over or {}
    local chapter_id = over.chapterId or "c1"
    local e = {
        chapterId = chapter_id,
        mangaId = "m1",
        title = "Berserk",
        chapterNumber = 41,
        direction = "rtl",
        fileName = Downloads.fileNameFor(chapter_id),
        size = 2048,
        createdAt = 1000,
    }
    for k, v in pairs(over) do e[k] = v end
    return e
end

-- A real device index over a fake store, seeded with the given entries in order, so
-- the Downloaded section is exercised against the actual state/downloads.lua reader.
local function seeded_downloads(entries)
    local downloads = Downloads.new(FakeStore.new(), DOWNLOAD_DIR)
    for _, e in ipairs(entries or {}) do
        downloads:add(e)
    end
    return downloads
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

        it("carries the API's continue target on each followed entry", function()
            local api = FakeApi.new{ listLibrary = LIBRARY }
            local library = Library.new(api)

            library:loadLibrary()

            local entries = library:getEntries()
            assert.are.same({ id = "c10", number = 41 }, entries[1].nextChapter)
            assert.is_true(entries[2].caughtUp)
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

    describe("continue label (KRP-607)", function()
        it("shows the next chapter number and opens that chapter", function()
            local label = Library.continueLabel({
                mangaId = "m3", nextChapter = { id = "c10", number = 41 }, caughtUp = false,
            })
            assert.are.equal("Continue (41)", label.text)
            assert.are.equal("c10", label.chapterId)
        end)

        it("shows 'Caught Up' with nothing to open when caught up", function()
            local label = Library.continueLabel({ mangaId = "m7", caughtUp = true })
            assert.are.equal("Caught Up", label.text)
            assert.is_nil(label.chapterId)
        end)

        it("falls back to a bare 'Continue' when the API omits the target", function()
            local label = Library.continueLabel({ mangaId = "m1" })
            assert.are.equal("Continue", label.text)
            assert.is_nil(label.chapterId)
        end)

        it("renders a decimal chapter number exactly, no rounding", function()
            local label = Library.continueLabel({
                mangaId = "m5", nextChapter = { id = "c3", number = 40.5 },
            })
            assert.are.equal("Continue (40.5)", label.text)
        end)

        it("trims only a trailing .0 from an integral chapter number", function()
            assert.are.equal("41", Library.formatChapterNumber(41.0))
            assert.are.equal("41", Library.formatChapterNumber(41))
            assert.are.equal("40.5", Library.formatChapterNumber(40.5))
            assert.are.equal("40.05", Library.formatChapterNumber(40.05))
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

    -- KRP-805 — the Downloaded section reads the device-local index (KRP-802), never
    -- the API, so it renders with wifi off. No FakeApi.listDownloads is stubbed: any
    -- call to the API here would be a bug.
    describe("downloaded chapters (device-local index, KRP-805)", function()
        it("reads the device index in insertion order, making no API call", function()
            local api = FakeApi.new{}
            local downloads = seeded_downloads{
                dl_entry{ chapterId = "c1" },
                dl_entry{ chapterId = "c2" },
                dl_entry{ chapterId = "c9" },
            }
            local library = Library.new(api, downloads)

            assert.are.same({ "c1", "c2", "c9" }, pluck(library:getDownloads(), "chapterId"))
            -- Offline guarantee: no network was touched to build the list.
            assert.are.equal(0, #api.calls)
        end)

        it("fetchDownloads reads the same device index (no network)", function()
            local downloads = seeded_downloads{ dl_entry{ chapterId = "c1" } }
            local library = Library.new(FakeApi.new{}, downloads)

            assert.are.same({ "c1" }, pluck(library:fetchDownloads(), "chapterId"))
        end)

        it("labels a downloaded row by title + chapter number", function()
            assert.are.equal("Berserk",
                Library.downloadTitle(dl_entry{ title = "Berserk" }))
            assert.are.equal("Ch. 41",
                Library.downloadNumber(dl_entry{ chapterNumber = 41 }))
            -- A decimal number renders exactly; an integral one trims its ".0".
            assert.are.equal("Ch. 40.5",
                Library.downloadNumber(dl_entry{ chapterNumber = 40.5 }))
        end)

        it("falls back to the mangaId when a row has no title", function()
            assert.are.equal("m1", Library.downloadTitle({ mangaId = "m1" }))
            assert.are.equal("m1", Library.downloadTitle({ mangaId = "m1", title = "" }))
        end)

        it("renders a blank number when a row carries none", function()
            assert.are.equal("", Library.downloadNumber({ mangaId = "m1" }))
        end)

        it("treats every indexed entry as openable (a persisted local CBZ)", function()
            local downloads = seeded_downloads{
                dl_entry{ chapterId = "c1" },
                dl_entry{ chapterId = "c9" },
            }
            local library = Library.new(FakeApi.new{}, downloads)

            assert.is_true(Library.isOpenable(dl_entry{}))
            assert.are.same({ "c1", "c9" }, pluck(library:getOpenableDownloads(), "chapterId"))
        end)

        it("shows an empty downloaded list when nothing is downloaded", function()
            local library = Library.new(FakeApi.new{}, seeded_downloads{})

            assert.are.same({}, library:getDownloads())
            assert.are.same({}, library:getOpenableDownloads())
        end)
    end)
end)
