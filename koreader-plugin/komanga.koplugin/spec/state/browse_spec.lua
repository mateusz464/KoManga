-- KRP-401 — [TEST] Source list & search (logic).
--
-- Defines the contract for state/browse.lua (implemented alongside the UI in
-- KRP-402): the pure state behind the source list and a source search. It is
-- framework-free so busted drives it with no KOReader loaded (CLAUDE.md §4 —
-- logic tickets are strict TDD; §5 — state/ is pure), and it reaches the network
-- only through an injected ApiClient, mocked HERE at the api/ boundary via
-- FakeApi (CLAUDE.md §5 — state never touches socket.http).
--
-- It owns three jobs (the KRP-401 acceptance criteria):
--   1. List the installed sources; surface empty + error states.
--   2. Run a search (query + source) → page 1; populate results; surface the
--      empty-results and error states.
--   3. Paginate ("load more"): advance through hasNextPage, appending results;
--      no-op once the source reports no further page.
--
-- Wire shapes are the unwrapped { data } envelopes api/client.lua returns
-- (KRP-302), per the shared API contract (RFC §8):
--   listSources() -> ({ {id,name,lang,iconUrl?}, ... }, nil) | (nil, err)
--   search{source,query,page} -> ({ mangas = { {id,title,thumbnailUrl?}, ... },
--                                   hasNextPage = <bool> }, nil) | (nil, err)
-- Errors are the typed table api/client.lua maps (KRP-301): { kind, status?, ... }.

local Browse = require("state.browse")
local FakeApi = require("spec.support.fake_api")

local SOURCES = {
    { id = "mangadex", name = "MangaDex", lang = "en" },
    { id = "comick", name = "ComicK", lang = "en" },
}

-- Two pages of search results: page 1 has more, page 2 ends the run. These are
-- builders, not constants, so every call hands back a FRESH table — a state impl
-- that accumulates results by appending to the client's returned list must not be
-- able to corrupt a value a later test reuses (test isolation).
local function PAGE_1()
    return {
        mangas = { { id = "m1", title = "Berserk" }, { id = "m2", title = "Bleach" } },
        hasNextPage = true,
    }
end
local function PAGE_2()
    return {
        mangas = { { id = "m3", title = "Boruto" } },
        hasNextPage = false,
    }
end

-- A search response keyed by requested page; pages not listed are an empty result.
local function paged(pages)
    return function(opts)
        local build = pages[opts.page]
        if build then return build() end
        return { mangas = {}, hasNextPage = false }
    end
end

local HTTP_ERROR = { kind = "http", status = 500, code = "INTERNAL" }
local TRANSPORT_ERROR = { kind = "transport", message = "wifi asleep" }

-- Collect the manga ids in result order, so order-preservation is assertable.
local function ids(list)
    local out = {}
    for _, m in ipairs(list) do
        out[#out + 1] = m.id
    end
    return out
end

describe("browse/search state", function()
    describe("source list", function()
        it("loads the installed sources into state", function()
            local api = FakeApi.new{ listSources = SOURCES }
            local browse = Browse.new(api)

            local ok, err = browse:loadSources()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same(SOURCES, browse:getSources())
            assert.are.equal(1, #api.calls)
            assert.are.equal("listSources", api.calls[1].method)
        end)

        it("handles an empty source list", function()
            local api = FakeApi.new{ listSources = {} }
            local browse = Browse.new(api)

            local ok = browse:loadSources()

            assert.is_true(ok)
            assert.are.same({}, browse:getSources())
            assert.is_nil(browse:getError())
        end)

        it("surfaces an error and leaves sources empty", function()
            local api = FakeApi.new{ listSources = function() return nil, HTTP_ERROR end }
            local browse = Browse.new(api)

            local ok, err = browse:loadSources()

            assert.is_false(ok)
            assert.are.same(HTTP_ERROR, err)
            assert.are.same(HTTP_ERROR, browse:getError())
            assert.are.same({}, browse:getSources())
        end)
    end)

    describe("search", function()
        it("submits the query and source and populates results (page 1)", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_1 } }
            local browse = Browse.new(api)

            local ok, err = browse:search("mangadex", "berserk")

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same({ "m1", "m2" }, ids(browse:getResults()))
            -- The exact request shape api/client.lua:search expects (KRP-302).
            assert.are.equal(1, #api.calls)
            assert.are.equal("search", api.calls[1].method)
            local sent = api.calls[1].args[1]
            assert.are.equal("mangadex", sent.source)
            assert.are.equal("berserk", sent.query)
            assert.are.equal(1, sent.page)
        end)

        it("records the query and source for later pagination", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_1 } }
            local browse = Browse.new(api)

            browse:search("comick", "vinland")

            assert.are.equal("comick", browse:getSource())
            assert.are.equal("vinland", browse:getQuery())
            assert.are.equal(1, browse:getPage())
        end)

        it("flags zero results as the empty state, not an error", function()
            local api = FakeApi.new{ search = function() return { mangas = {}, hasNextPage = false } end }
            local browse = Browse.new(api)

            local ok = browse:search("mangadex", "zzznotfound")

            assert.is_true(ok)
            assert.are.same({}, browse:getResults())
            assert.is_true(browse:isEmpty())
            assert.is_nil(browse:getError())
        end)

        it("does not report empty when results are present", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_1 } }
            local browse = Browse.new(api)

            browse:search("mangadex", "berserk")

            assert.is_false(browse:isEmpty())
        end)

        it("surfaces a search error", function()
            local api = FakeApi.new{ search = function() return nil, TRANSPORT_ERROR end }
            local browse = Browse.new(api)

            local ok, err = browse:search("mangadex", "berserk")

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, browse:getError())
            assert.is_false(browse:isEmpty())
        end)

        it("clears a prior error on a successful search", function()
            local api = FakeApi.new{
                search = function(opts)
                    if opts.query == "boom" then return nil, HTTP_ERROR end
                    return PAGE_1()
                end,
            }
            local browse = Browse.new(api)

            browse:search("mangadex", "boom")
            assert.are.same(HTTP_ERROR, browse:getError())

            browse:search("mangadex", "berserk")
            assert.is_nil(browse:getError())
        end)

        it("replaces results and resets pagination on a fresh search", function()
            local api = FakeApi.new{
                search = function(opts)
                    if opts.query == "first" then return PAGE_1() end
                    return PAGE_2()
                end,
            }
            local browse = Browse.new(api)

            browse:search("mangadex", "first")
            assert.is_true(browse:hasMore())

            browse:search("mangadex", "second")
            -- A new search starts from page 1 with only its own results.
            assert.are.same({ "m3" }, ids(browse:getResults()))
            assert.are.equal(1, browse:getPage())
            assert.is_false(browse:hasMore())
        end)
    end)

    describe("pagination / load more", function()
        it("reports more pages from hasNextPage", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_1 } }
            local browse = Browse.new(api)

            browse:search("mangadex", "b")

            assert.is_true(browse:hasMore())
        end)

        it("appends the next page in order and advances the page number", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_1, [2] = PAGE_2 } }
            local browse = Browse.new(api)
            browse:search("mangadex", "b")

            local ok, err = browse:loadMore()

            assert.is_true(ok)
            assert.is_nil(err)
            assert.are.same({ "m1", "m2", "m3" }, ids(browse:getResults()))
            assert.are.equal(2, browse:getPage())
            assert.is_false(browse:hasMore())
            -- The second request asked for page 2 of the same query/source.
            local sent = api.calls[2].args[1]
            assert.are.equal("mangadex", sent.source)
            assert.are.equal("b", sent.query)
            assert.are.equal(2, sent.page)
        end)

        it("is a no-op once the source reports no further page", function()
            local api = FakeApi.new{ search = paged{ [1] = PAGE_2 } } -- hasNextPage = false
            local browse = Browse.new(api)
            browse:search("mangadex", "b")

            local ok = browse:loadMore()

            assert.is_false(ok)
            -- No extra request beyond the initial search.
            assert.are.equal(1, #api.calls)
            assert.are.same({ "m3" }, ids(browse:getResults()))
        end)

        it("does nothing before a search has run", function()
            local api = FakeApi.new{}
            local browse = Browse.new(api)

            local ok = browse:loadMore()

            assert.is_false(ok)
            assert.are.equal(0, #api.calls)
        end)

        it("keeps results and the page on a load-more error so a retry is possible", function()
            local api = FakeApi.new{
                search = function(opts)
                    if opts.page == 1 then return PAGE_1() end
                    return nil, TRANSPORT_ERROR
                end,
            }
            local browse = Browse.new(api)
            browse:search("mangadex", "b")

            local ok, err = browse:loadMore()

            assert.is_false(ok)
            assert.are.same(TRANSPORT_ERROR, err)
            assert.are.same(TRANSPORT_ERROR, browse:getError())
            -- Page not advanced and existing results intact → caller can retry.
            assert.are.same({ "m1", "m2" }, ids(browse:getResults()))
            assert.are.equal(1, browse:getPage())
            assert.is_true(browse:hasMore())
        end)
    end)

    describe("source browsing modes", function()
        it("loads popular results and paginates through the browse endpoint", function()
            local api = FakeApi.new{ browse = paged{ [1] = PAGE_1, [2] = PAGE_2 } }
            local browse = Browse.new(api)

            assert.is_true(browse:browse("mangadex", "popular"))
            assert.are.equal("popular", browse:getMode())
            assert.is_true(browse:loadMore())
            assert.are.same({ "m1", "m2", "m3" }, ids(browse:getResults()))
            assert.are.equal("browse", api.calls[2].method)
            assert.are.equal(2, api.calls[2].args[1].page)
        end)

        it("loads genre options then echoes the selected opaque token to search", function()
            local api = FakeApi.new{
                listSourceGenres = { { name = "Action", token = "opaque-action" } },
                search = PAGE_2(),
            }
            local browse = Browse.new(api)

            local genres = browse:fetchGenres("mangadex")
            assert.are.equal("opaque-action", genres[1].token)
            assert.is_true(browse:genre("mangadex", genres[1]))
            assert.are.equal("genres", browse:getMode())
            assert.are.equal("opaque-action", browse:getGenre().token)
            assert.are.same({ "opaque-action" }, api.calls[2].args[1].genres)
        end)

        it("keeps the active mode and results intact after a paging error", function()
            local api = FakeApi.new{ browse = function(opts)
                if opts.page == 1 then return PAGE_1() end
                return nil, TRANSPORT_ERROR
            end }
            local browse = Browse.new(api)
            browse:browse("mangadex", "latest")

            assert.is_false(browse:loadMore())
            assert.are.equal("latest", browse:getMode())
            assert.are.same({ "m1", "m2" }, ids(browse:getResults()))
            assert.are.equal(1, browse:getPage())
        end)
    end)
end)
