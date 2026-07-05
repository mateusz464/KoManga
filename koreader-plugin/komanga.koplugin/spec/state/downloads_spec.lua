-- KRP-801 — [TEST] Device-local download store & index (logic).
--
-- Defines the contract for state/downloads.lua: the pure state that owns the
-- device-local download index (RFC §5.4 — "download for offline" persists the
-- built eink CBZ on the Kobo so the "Downloaded" list renders and opens with wifi
-- off). It is framework-free so busted drives it with no KOReader loaded
-- (CLAUDE.md §4 — logic tickets are strict TDD; §5 — state/ is pure). Persistence
-- is injected (FakeStore, mirroring settings.lua's injected-store pattern,
-- CLAUDE.md §9 — pass collaborators in); the on-device CBZ directory is injected
-- too, so no DataStorage/LuaSettings coupling leaks into the pure module.
--
-- Contract:
--   * add(entry)        — record a download; idempotent per chapterId (no dupes).
--   * get(chapterId)    — the stored entry, or nil.
--   * has(chapterId)    — boolean membership.
--   * list()            — the entries in a stable (insertion) order.
--   * remove(chapterId) — drop the entry, RETURNING the local CBZ path the caller
--                         must unlink to free storage (nil when absent).
--   * fileNameFor(id) / pathFor(id) — pure path/layout helpers for a chapter's CBZ.
-- The index persists through the injected store, so a fresh instance over the same
-- store (a KOReader restart) sees prior downloads — the offline-list guarantee.
-- Each entry carries { chapterId, mangaId, title, chapterNumber, direction,
-- fileName, size, createdAt } so the list is legible and openable offline.

local Downloads = require("state.downloads")
local FakeStore = require("spec.support.fake_store")

local DOWNLOAD_DIR = "/data/komanga/downloads"

-- A complete index entry; `over` patches individual fields. fileName is derived
-- from the chapterId so it stays consistent with the path helpers (that is how the
-- coordinator records it — KRP-803).
local function entry(over)
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

local function new_downloads(store)
    return Downloads.new(store or FakeStore.new(), DOWNLOAD_DIR)
end

describe("downloads (device-local index) state", function()
    describe("add / get / has", function()
        it("records an entry and reads it back whole", function()
            local dl = new_downloads()
            local e = entry()

            dl:add(e)

            assert.is_true(dl:has("c1"))
            assert.are.same(e, dl:get("c1"))
        end)

        it("reports has=false and get=nil for an unknown chapter", function()
            local dl = new_downloads()
            assert.is_false(dl:has("nope"))
            assert.is_nil(dl:get("nope"))
        end)

        it("preserves every field the offline list needs", function()
            local dl = new_downloads()
            dl:add(entry{
                chapterId = "c9",
                mangaId = "m3",
                title = "Vinland Saga",
                chapterNumber = 40.5,
                direction = "ltr",
                size = 4096,
                createdAt = 1234,
            })

            local got = dl:get("c9")
            assert.are.equal("m3", got.mangaId)
            assert.are.equal("Vinland Saga", got.title)
            assert.are.equal(40.5, got.chapterNumber)
            assert.are.equal("ltr", got.direction)
            assert.are.equal(4096, got.size)
            assert.are.equal(1234, got.createdAt)
            assert.are.equal(Downloads.fileNameFor("c9"), got.fileName)
        end)
    end)

    describe("idempotency (per chapterId)", function()
        it("does not duplicate a chapter added twice", function()
            local dl = new_downloads()
            dl:add(entry{ chapterId = "c1" })
            dl:add(entry{ chapterId = "c1" })

            assert.are.equal(1, #dl:list())
            assert.is_true(dl:has("c1"))
        end)
    end)

    describe("list (stable order)", function()
        it("returns entries in insertion order", function()
            local dl = new_downloads()
            dl:add(entry{ chapterId = "c1" })
            dl:add(entry{ chapterId = "c2" })
            dl:add(entry{ chapterId = "c3" })

            local list = dl:list()
            assert.are.equal(3, #list)
            assert.are.equal("c1", list[1].chapterId)
            assert.are.equal("c2", list[2].chapterId)
            assert.are.equal("c3", list[3].chapterId)
        end)

        it("is empty before anything is added", function()
            assert.are.same({}, new_downloads():list())
        end)
    end)

    describe("remove", function()
        it("drops the entry and returns its local CBZ path to unlink", function()
            local dl = new_downloads()
            dl:add(entry{ chapterId = "c2" })

            local path = dl:remove("c2")

            assert.are.equal(dl:pathFor("c2"), path)
            assert.is_false(dl:has("c2"))
            assert.is_nil(dl:get("c2"))
        end)

        it("returns nil and changes nothing when the chapter is absent", function()
            local dl = new_downloads()
            dl:add(entry{ chapterId = "c1" })

            assert.is_nil(dl:remove("gone"))
            assert.are.equal(1, #dl:list())
            assert.is_true(dl:has("c1"))
        end)

        it("keeps the remaining entries in order", function()
            local dl = new_downloads()
            dl:add(entry{ chapterId = "c1" })
            dl:add(entry{ chapterId = "c2" })
            dl:add(entry{ chapterId = "c3" })

            dl:remove("c2")

            local list = dl:list()
            assert.are.equal(2, #list)
            assert.are.equal("c1", list[1].chapterId)
            assert.are.equal("c3", list[2].chapterId)
        end)
    end)

    describe("path / layout helpers (pure)", function()
        it("names a chapter's CBZ file deterministically", function()
            assert.are.equal(Downloads.fileNameFor("c1"), Downloads.fileNameFor("c1"))
            assert.is_truthy(Downloads.fileNameFor("c1"):match("%.cbz$"))
        end)

        it("keeps the filename filesystem-safe (no path separators)", function()
            local name = Downloads.fileNameFor("src/42:1")
            assert.is_nil(name:find("/", 1, true))
            assert.is_truthy(name:match("%.cbz$"))
        end)

        it("resolves the full on-device path under the injected download dir", function()
            local dl = new_downloads()
            assert.are.equal(DOWNLOAD_DIR .. "/" .. Downloads.fileNameFor("c1"), dl:pathFor("c1"))
        end)
    end)

    describe("persistence through the injected store", function()
        it("flushes on add so the index survives a restart", function()
            local store = FakeStore.new()
            local dl = new_downloads(store)

            dl:add(entry{ chapterId = "c1" })

            assert.is_true(store.flushes > 0)
        end)

        it("flushes on remove", function()
            local store = FakeStore.new()
            local dl = new_downloads(store)
            dl:add(entry{ chapterId = "c1" })
            local before = store.flushes

            dl:remove("c1")

            assert.is_true(store.flushes > before)
        end)

        it("a fresh instance over the same store sees prior downloads (a reload)", function()
            local store = FakeStore.new()
            local writer = new_downloads(store)
            writer:add(entry{ chapterId = "c1" })
            writer:add(entry{ chapterId = "c2" })

            -- A KOReader restart: a new Downloads over the persisted store.
            local reloaded = new_downloads(store)

            assert.is_true(reloaded:has("c1"))
            assert.is_true(reloaded:has("c2"))
            assert.are.equal(2, #reloaded:list())
            assert.are.same(writer:get("c1"), reloaded:get("c1"))
        end)

        it("a removal is visible to a fresh instance", function()
            local store = FakeStore.new()
            local writer = new_downloads(store)
            writer:add(entry{ chapterId = "c1" })
            writer:add(entry{ chapterId = "c2" })
            writer:remove("c1")

            local reloaded = new_downloads(store)
            assert.is_false(reloaded:has("c1"))
            assert.is_true(reloaded:has("c2"))
        end)
    end)
end)
