-- KRP-803 — [TEST] Download-to-device coordinator (logic).
--
-- Defines the contract for state/download_coordinator.lua: the pure state that
-- performs an OFFLINE download (RFC §5.4). It fetches a chapter's TRANSIENT eink
-- CBZ (ApiClient:readChapterCbzToFile, KRP-606 — GET /api/chapter/:id/cbz, built +
-- session-cached, with NO server download record) straight to the device store's
-- path (state/downloads.lua's pathFor, KRP-802), then records the device-local
-- index entry with the metadata the offline list + reader need (title /
-- chapterNumber / direction) so the "Downloaded" list is legible and opens with
-- wifi off. It must NEVER touch the server-side download endpoint
-- (ApiClient:downloadChapter / POST /download) — that path persists a server record
-- the offline feature deliberately no longer relies on (RFC §5.4).
--
-- It is framework-free so busted drives it with no KOReader loaded (CLAUDE.md §4 —
-- logic tickets are strict TDD; §5 — state/ is pure). The network is mocked at the
-- api/ boundary (an injected fake client, never socket.http); the index store and
-- the clock / file-size collaborators are injected too (CLAUDE.md §9).
--
-- Contract:
--   DownloadCoordinator.new(api, downloads, opts?)   -- opts = { now?, file_size? }
--   :fetchCbz(chapter)      -- pure fetch, safe to run off-thread in net.lua's
--                              forked sub-process (KRP-305): streams the transient
--                              eink CBZ to downloads:pathFor(id); returns
--                              (path, nil) or (nil, err). Idempotent — an
--                              already-downloaded chapter returns its path with NO
--                              network call.
--   :record(chapter, path)  -- parent-side apply: add the index entry (idempotent);
--                              returns the stored entry.
--   :download(chapter)      -- the tested composition of fetchCbz + record: returns
--                              (entry, nil) on success, (nil, err) on a fetch failure
--                              (recording NOTHING — the transient fetch already
--                              removed any partial file), or the existing entry
--                              (a no-op) when the chapter is already downloaded.
-- `chapter` = { chapterId, mangaId, title, chapterNumber, direction }.
--
-- The fetch/apply split mirrors the other state modules (state/browse.lua,
-- state/reader.lua): net.lua runs `fetchCbz` in a forked sub-process that cannot
-- mutate the parent's index across the fork, so the UI (KRP-804) calls `record` in
-- net's on_result callback (parent side); these specs drive the combined `download`
-- in-process.

local Coordinator = require("state.download_coordinator")
local Downloads = require("state.downloads")
local FakeStore = require("spec.support.fake_store")

local DOWNLOAD_DIR = "/data/komanga/downloads"
local CBZ_SIZE = 2048
local NOW = 1000

-- A complete chapter descriptor (what the reader context threads in, KRP-804);
-- `over` patches individual fields.
local function chapter(over)
    over = over or {}
    local c = {
        chapterId = "c1",
        mangaId = "m1",
        title = "Berserk",
        chapterNumber = 41,
        direction = "rtl",
    }
    for k, v in pairs(over) do c[k] = v end
    return c
end

-- Fake ApiClient at the api/ boundary. Models readChapterCbzToFile's stream-to-file
-- behaviour over an in-memory `fs` (path -> size), INCLUDING its partial-file
-- cleanup on failure (the real method os.remove(destPath)s on error — KRP-606), so
-- the spec can assert "a failure leaves no file". `downloadChapter` is present only
-- so the spec can prove the coordinator never calls it. Records every call.
local function fake_api(opts)
    opts = opts or {}
    return {
        fs = opts.fs or {},
        calls = {},
        fetch_err = opts.fetch_err,
        readChapterCbzToFile = function(self, chapterId, destPath)
            table.insert(self.calls, {
                method = "readChapterCbzToFile", chapterId = chapterId, destPath = destPath,
            })
            if self.fetch_err then
                self.fs[destPath] = nil
                return nil, self.fetch_err
            end
            self.fs[destPath] = CBZ_SIZE
            return destPath, nil
        end,
        downloadChapter = function(self, chapterId, mangaId)
            table.insert(self.calls, {
                method = "downloadChapter", chapterId = chapterId, mangaId = mangaId,
            })
            return { chapterId = chapterId, mangaId = mangaId, status = "completed" }
        end,
    }
end

local function new_downloads(store)
    return Downloads.new(store or FakeStore.new(), DOWNLOAD_DIR)
end

-- Inject a fixed clock and a file-size reader over the fake fs, so createdAt/size are
-- deterministic without a real file (CLAUDE.md §9 — pass collaborators in).
local function new_coordinator(api, downloads)
    return Coordinator.new(api, downloads, {
        now = function() return NOW end,
        file_size = function(path) return api.fs[path] end,
    })
end

describe("download-to-device coordinator", function()
    describe("fetch path (transient, eink)", function()
        it("fetches the transient eink CBZ to the device store path", function()
            local api = fake_api()
            local dl = new_downloads()

            new_coordinator(api, dl):download(chapter())

            assert.are.equal(1, #api.calls)
            assert.are.equal("readChapterCbzToFile", api.calls[1].method)
            assert.are.equal("c1", api.calls[1].chapterId)
            assert.are.equal(dl:pathFor("c1"), api.calls[1].destPath)
        end)

        it("never uses the server-side download endpoint (POST /download)", function()
            local api = fake_api()
            local dl = new_downloads()

            new_coordinator(api, dl):download(chapter())

            for _, c in ipairs(api.calls) do
                assert.are_not.equal("downloadChapter", c.method)
            end
        end)

        it("streams the CBZ to the store path on success", function()
            local api = fake_api()
            local dl = new_downloads()

            new_coordinator(api, dl):download(chapter())

            assert.are.equal(CBZ_SIZE, api.fs[dl:pathFor("c1")])
        end)
    end)

    describe("success records the index entry", function()
        it("records the entry with the offline-list metadata", function()
            local api = fake_api()
            local dl = new_downloads()

            local entry, err = new_coordinator(api, dl):download(chapter{
                chapterId = "c9",
                mangaId = "m3",
                title = "Vinland Saga",
                chapterNumber = 40.5,
                direction = "ltr",
            })

            assert.is_nil(err)
            assert.is_true(dl:has("c9"))
            assert.are.equal("c9", entry.chapterId)
            assert.are.equal("m3", entry.mangaId)
            assert.are.equal("Vinland Saga", entry.title)
            assert.are.equal(40.5, entry.chapterNumber)
            assert.are.equal("ltr", entry.direction)
            assert.are.equal(Downloads.fileNameFor("c9"), entry.fileName)
        end)

        it("records size and creation time from the injected collaborators", function()
            local api = fake_api()
            local dl = new_downloads()

            local entry = new_coordinator(api, dl):download(chapter())

            assert.are.equal(CBZ_SIZE, entry.size)
            assert.are.equal(NOW, entry.createdAt)
        end)

        it("returns the entry that is stored in the index", function()
            local api = fake_api()
            local dl = new_downloads()

            local entry = new_coordinator(api, dl):download(chapter())

            assert.are.same(dl:get("c1"), entry)
        end)
    end)

    describe("fetch failure records nothing", function()
        it("adds no index entry when the fetch fails", function()
            local api = fake_api{ fetch_err = { kind = "transport" } }
            local dl = new_downloads()

            local entry, err = new_coordinator(api, dl):download(chapter())

            assert.is_nil(entry)
            assert.are.same({ kind = "transport" }, err)
            assert.is_false(dl:has("c1"))
            assert.are.equal(0, #dl:list())
        end)

        it("leaves no partial file when the fetch fails", function()
            local api = fake_api{ fetch_err = { kind = "http", status = 404 } }
            local dl = new_downloads()

            new_coordinator(api, dl):download(chapter())

            assert.is_nil(api.fs[dl:pathFor("c1")])
        end)
    end)

    describe("idempotency (already-downloaded is a no-op success)", function()
        it("does not re-fetch a chapter downloaded earlier this session", function()
            local api = fake_api()
            local dl = new_downloads()
            local coord = new_coordinator(api, dl)
            coord:download(chapter())
            local calls_after_first = #api.calls

            local entry, err = coord:download(chapter())

            assert.is_nil(err)
            assert.are.equal("c1", entry.chapterId)
            assert.are.equal(calls_after_first, #api.calls)
            assert.are.equal(1, #dl:list())
        end)

        it("treats a chapter in the persisted index as downloaded (no network)", function()
            local store = FakeStore.new()
            -- A prior session already downloaded c1 (persisted through the store).
            new_downloads(store):add(chapter{
                fileName = Downloads.fileNameFor("c1"),
                size = 1,
                createdAt = 1,
            })

            local api = fake_api()
            local reloaded = new_downloads(store)

            local entry, err = new_coordinator(api, reloaded):download(chapter())

            assert.is_nil(err)
            assert.are.equal(0, #api.calls)
            assert.are.equal("c1", entry.chapterId)
        end)
    end)

    describe("fetch / record split (for net.lua's forked sub-process)", function()
        it("fetchCbz streams to the store path and mutates no index (fork-safe)", function()
            local api = fake_api()
            local dl = new_downloads()

            local path, err = new_coordinator(api, dl):fetchCbz(chapter())

            assert.is_nil(err)
            assert.are.equal(dl:pathFor("c1"), path)
            assert.are.equal("readChapterCbzToFile", api.calls[1].method)
            assert.is_false(dl:has("c1"))
        end)

        it("fetchCbz on an already-downloaded chapter returns its path with no network", function()
            local api = fake_api()
            local dl = new_downloads()
            dl:add(chapter{ fileName = Downloads.fileNameFor("c1"), size = 1, createdAt = 1 })

            local path, err = new_coordinator(api, dl):fetchCbz(chapter())

            assert.is_nil(err)
            assert.are.equal(dl:pathFor("c1"), path)
            assert.are.equal(0, #api.calls)
        end)

        it("record adds the index entry parent-side", function()
            local api = fake_api()
            local dl = new_downloads()
            local coord = new_coordinator(api, dl)
            local path = dl:pathFor("c1")
            api.fs[path] = CBZ_SIZE -- as if the child sub-process already streamed it

            local entry = coord:record(chapter(), path)

            assert.is_true(dl:has("c1"))
            assert.are.same(dl:get("c1"), entry)
            assert.are.equal(CBZ_SIZE, entry.size)
        end)
    end)
end)
