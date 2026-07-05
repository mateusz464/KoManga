-- KRP-501/606 — [TEST] Chapter acquisition & page mapping (logic).
--
-- Defines the contract for state/reader.lua: the pure state behind acquiring a
-- chapter for reading via the CBZ + ReaderUI path. It is framework-free so busted
-- drives it with no KOReader loaded (CLAUDE.md §4 — logic tickets are strict TDD;
-- §5 — state/ is pure), reaching the network only through an injected ApiClient,
-- mocked HERE at the api/ boundary via FakeApi (CLAUDE.md §5 — state never touches
-- socket.http).
--
-- It owns two jobs:
--   1. Acquire the chapter's `eink` CBZ via the TRANSIENT read path (KRP-606):
--      ApiClient:readChapterCbzToFile hits GET /api/chapter/:id/cbz, which builds
--      and serves the eink CBZ WITHOUT persisting a download record — so reading a
--      chapter never adds it to "Downloaded" (only the explicit POST /download
--      does). The fetch streams to a file and returns (path, err); the bytes never
--      cross net.lua's fork (KRP-305). This client never builds a `raw` CBZ (§6).
--   2. Map the API page index ↔ CBZ page index. API page indices are 0-based
--      (chapter-service serves `<chapterId>:<index>`); KOReader's CBZ reader is
--      1-based, so the mapping is a fixed ±1 offset. KRP-502/602 use it to seek to
--      a resumed position and to translate the current page back for progress push.

local Reader = require("state.reader")
local FakeApi = require("spec.support.fake_api")

local MANGA_ID = "m7"
local CHAPTER_ID = "c2"
local DEST = "/data/komanga/downloads/c2.cbz"

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

describe("reader (chapter acquisition) state", function()
    describe("acquiring the eink CBZ (transient read path)", function()
        it("fetches through the transient, eink-only read endpoint, not a download", function()
            local api = FakeApi.new{
                readChapterCbzToFile = function(_, destPath) return destPath end,
            }
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local path, err = reader:fetchCbz(DEST)

            assert.is_nil(err)
            assert.are.equal(DEST, path)
            -- Reading goes through readChapterCbzToFile (transient, always eink) with
            -- this chapter + its dest path — never downloadChapter, so plain reading
            -- persists no download (KRP-606 acceptance #1).
            assert.are.equal(1, #api.calls)
            assert.are.equal("readChapterCbzToFile", api.calls[1].method)
            assert.are.equal(CHAPTER_ID, api.calls[1].args[1])
            assert.are.equal(DEST, api.calls[1].args[2])
        end)

        it("surfaces a transport/HTTP error and acquires nothing", function()
            local api = FakeApi.new{
                readChapterCbzToFile = function() return nil, TRANSPORT_ERROR end,
            }
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local path, err = reader:fetchCbz(DEST)

            assert.is_nil(path)
            assert.are.same(TRANSPORT_ERROR, err)
        end)

        it("propagates the client's error table unchanged", function()
            local api = FakeApi.new{
                readChapterCbzToFile = function() return nil, HTTP_ERROR end,
            }
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local _, err = reader:fetchCbz(DEST)

            assert.are.same(HTTP_ERROR, err)
        end)

        it("exposes its chapter id", function()
            local reader = Reader.new(FakeApi.new{}, MANGA_ID, CHAPTER_ID)
            assert.are.equal(CHAPTER_ID, reader:getChapterId())
        end)
    end)

    describe("fetch is pure (net.lua off-thread fork, KRP-305)", function()
        -- net.lua runs the blocking fetch in a forked sub-process and never marshals
        -- the CBZ bytes back (a fork can't return tens of MB). So fetchCbz must be a
        -- pure API call that streams to a file and returns only the small path.
        it("fetchCbz is exactly the API call, returning (path, err)", function()
            local api = FakeApi.new{
                readChapterCbzToFile = function(_, destPath) return destPath end,
            }
            local reader = Reader.new(api, MANGA_ID, CHAPTER_ID)

            local path = reader:fetchCbz(DEST)

            assert.are.equal(DEST, path)
            assert.are.equal("readChapterCbzToFile", api.calls[1].method)
        end)
    end)

    describe("API page index ↔ CBZ page index mapping", function()
        -- API page indices are 0-based; KOReader's CBZ reader is 1-based.
        it("maps an API page index to its 1-based CBZ page", function()
            assert.are.equal(1, Reader.apiPageToCbzPage(0))
            assert.are.equal(6, Reader.apiPageToCbzPage(5))
        end)

        it("maps a CBZ page back to its 0-based API page index", function()
            assert.are.equal(0, Reader.cbzPageToApiPage(1))
            assert.are.equal(5, Reader.cbzPageToApiPage(6))
        end)

        it("round-trips a page index through both directions", function()
            for apiIndex = 0, 9 do
                assert.are.equal(apiIndex, Reader.cbzPageToApiPage(Reader.apiPageToCbzPage(apiIndex)))
            end
        end)
    end)
end)
