-- KOM-160 — [TEST] Next-chapter resolution (logic).
--
-- Defines the contract for state/next_chapter.lua: the pure state behind the
-- "continue to the next chapter" popup. Given the chapter the reader has open
-- (recovered from the DocSettings sidecar), it fetches the manga's ascending-
-- chapterNumber chapter list through the injected ApiClient (mocked HERE at the
-- api/ boundary via FakeApi, CLAUDE.md §5) and resolves the entry immediately
-- after the current chapter id, exposing the descriptor the reader launcher
-- needs: chapter id, name, chapterNumber, the manga's readingDirection and its
-- title (the launcher writes both into the next document's sidecar).
--
-- Same fetch*/apply* split as state/details.lua: net.lua runs fetchManga in a
-- forked sub-process, so the parent applies the result via applyManga. Until a
-- successful apply, or after a failed one, nothing is resolved — the popup
-- simply doesn't offer (resolution failure is silent by design).

local NextChapter = require("state.next_chapter")
local FakeApi = require("spec.support.fake_api")

local MANGA_ID = "m7"

-- A builder, not a constant: every call hands back a FRESH payload so an impl
-- that mutates it can't corrupt a later test. Chapters ascend by chapterNumber,
-- as /api/manga/:id serves them (manga-service sorts the list).
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

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }

describe("next-chapter resolution state", function()
    it("fetches the manga through the injected api client", function()
        local api = FakeApi.new{ getManga = DETAILS }
        local state = NextChapter.new(api, MANGA_ID, "c2")

        state:fetchManga()

        assert.are.equal(1, #api.calls)
        assert.are.equal("getManga", api.calls[1].method)
        assert.are.equal(MANGA_ID, api.calls[1].args[1])
    end)

    it("resolves the chapter after the current one, with the launcher fields", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c2")

        local ok = state:applyManga(DETAILS(), nil)

        assert.is_true(ok)
        assert.are.same({
            id = "c3",
            name = "Chapter 3",
            chapterNumber = 3,
            direction = "rtl",
            mangaTitle = "Berserk",
        }, state:getNext())
    end)

    it("resolves nil for the last chapter", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c3")

        assert.is_true(state:applyManga(DETAILS(), nil))

        assert.is_nil(state:getNext())
    end)

    it("resolves nil when the current chapter is absent from the list", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "gone")

        assert.is_true(state:applyManga(DETAILS(), nil))

        assert.is_nil(state:getNext())
    end)

    it("resolves nil for an empty or missing chapter list", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c2")

        assert.is_true(state:applyManga({ manga = { id = MANGA_ID } }, nil))

        assert.is_nil(state:getNext())
    end)

    it("reports failure and resolves nothing on a fetch error", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c2")

        local ok, err = state:applyManga(nil, HTTP_ERROR)

        assert.is_false(ok)
        assert.are.equal(HTTP_ERROR, err)
        assert.is_nil(state:getNext())
    end)

    it("resolves nothing before a result is applied", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c2")

        assert.is_nil(state:getNext())
    end)

    it("recovers when a retried fetch succeeds after an error", function()
        local state = NextChapter.new(FakeApi.new(), MANGA_ID, "c2")

        state:applyManga(nil, HTTP_ERROR)
        assert.is_true(state:applyManga(DETAILS(), nil))

        assert.are.equal("c3", state:getNext().id)
    end)
end)
