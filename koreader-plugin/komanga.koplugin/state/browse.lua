-- KRP-401/402 — Source list & search (logic). The pure, framework-free state
-- behind the source list and a source search (CLAUDE.md §5: state/ is pure,
-- busted-testable with no KOReader loaded). It reaches the network only through an
-- injected ApiClient (CLAUDE.md §5/§9 — state never touches socket.http).
--
-- It owns three jobs (the KRP-401 acceptance criteria):
--   1. List the installed sources; surface empty + error states.
--   2. Run a search (source + query) → page 1; populate results; surface the
--      empty-results and error states.
--   3. Paginate ("load more"): advance through hasNextPage, appending results in
--      order; no-op once the source reports no further page (or before a search).
--
-- Each job is split into a pure `fetch*` (the blocking API call, returning the
-- (data, err) contract of api/client.lua) and an `apply*` (mutates this state with
-- that result). The synchronous `loadSources`/`search`/`loadMore` are simply their
-- composition — that is what the busted specs drive. The UI (KRP-402) keeps them
-- apart: it runs the fetch through net.lua (the blocking call goes off the UI
-- thread, in a forked sub-process) and then applies the result here in the parent,
-- since a sub-process can't mutate this table across the fork.

local Browse = {}
Browse.__index = Browse

-- api: an ApiClient (or a fake exposing listSources/search). Injected, not global.
function Browse.new(api)
    return setmetatable({
        api = api,
        sources = {},
        results = {},
        page = 0,
        has_next_page = false,
        searched = false,
        error = nil,
        source = nil,
        query = nil,
    }, Browse)
end

-- --- Source list ---------------------------------------------------------------

-- Pure fetch (safe to run off-thread): returns the ApiClient (data, err).
function Browse:fetchSources()
    return self.api:listSources()
end

-- Apply a fetched source list. On error, sources are left as they were and the
-- error is surfaced via getError(); on success the error is cleared.
function Browse:applySources(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.sources = data
    return true
end

function Browse:loadSources()
    return self:applySources(self:fetchSources())
end

function Browse:getSources()
    return self.sources
end

-- --- Search --------------------------------------------------------------------

-- Pure fetch of page 1 for a fresh search.
function Browse:fetchSearch(source, query)
    return self.api:search{ source = source, query = query, page = 1 }
end

-- Apply a fresh search result: always resets to page 1 and replaces prior results
-- and pagination. Zero results is the empty state, NOT an error (see isEmpty).
function Browse:applySearch(source, query, data, err)
    self.source = source
    self.query = query
    self.page = 1
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    self.results = data.mangas or {}
    self.has_next_page = data.hasNextPage or false
    self.searched = true
    return true
end

function Browse:search(source, query)
    return self:applySearch(source, query, self:fetchSearch(source, query))
end

function Browse:getResults()
    return self.results
end

-- --- Pagination / load more ----------------------------------------------------

-- Pure fetch of the next page of the current search. Callers must gate on
-- hasMore() first (loadMore and the UI both do) so this is never a wasted request.
function Browse:fetchMore()
    return self.api:search{ source = self.source, query = self.query, page = self.page + 1 }
end

-- Append a fetched next page in order and advance the page number. On error the
-- existing results and page are kept intact so the caller can retry.
function Browse:applyMore(data, err)
    if err then
        self.error = err
        return false, err
    end
    self.error = nil
    for _, manga in ipairs(data.mangas or {}) do
        self.results[#self.results + 1] = manga
    end
    self.page = self.page + 1
    self.has_next_page = data.hasNextPage or false
    return true
end

-- A no-op (returns false, no request) before any search has run or once the source
-- reports no further page.
function Browse:loadMore()
    if not self.has_next_page then
        return false
    end
    return self:applyMore(self:fetchMore())
end

-- --- Read-only state -----------------------------------------------------------

function Browse:getSource()
    return self.source
end

function Browse:getQuery()
    return self.query
end

function Browse:getPage()
    return self.page
end

function Browse:getError()
    return self.error
end

-- True only when a search succeeded with zero results (the empty state). False
-- before any search, when results are present, and when an error is outstanding.
function Browse:isEmpty()
    return self.searched and self.error == nil and #self.results == 0
end

function Browse:hasMore()
    return self.has_next_page
end

return Browse
