-- Pure, framework-free state behind the source list and search, reaching the network
-- only through an injected ApiClient.
--
-- Each job is split into a pure `fetch*` (the blocking API call) and an `apply*`
-- (mutates this state). The busted specs drive their composition (loadSources/
-- search/loadMore); the UI keeps them apart because net.lua runs the fetch in a
-- forked sub-process that can't mutate this table across the fork, so it applies the
-- result here in the parent. state/details.lua and the other state modules follow
-- this same split.

local Browse = {}
Browse.__index = Browse

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
        mode = nil,
        genre = nil,
    }, Browse)
end

-- --- Source list ---------------------------------------------------------------

function Browse:fetchSources()
    return self.api:listSources()
end

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

function Browse:fetchSearch(source, query)
    return self.api:search{ source = source, query = query, page = 1 }
end

-- Resets to page 1, replacing prior results. Zero results is the empty state (see
-- isEmpty), NOT an error.
function Browse:applySearch(source, query, data, err)
    self.source = source
    self.query = query
    self.mode = "search"
    self.genre = nil
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

function Browse:fetchBrowse(source, mode)
    return self.api:browse{ source = source, mode = mode, page = 1 }
end

function Browse:applyBrowse(source, mode, data, err)
    self.source = source
    self.query = nil
    self.mode = mode
    self.genre = nil
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

function Browse:browse(source, mode)
    return self:applyBrowse(source, mode, self:fetchBrowse(source, mode))
end

function Browse:fetchGenres(source)
    return self.api:listSourceGenres(source)
end

function Browse:fetchGenre(source, genre)
    return self.api:search{ source = source, query = "", genres = { genre.token }, page = 1 }
end

function Browse:applyGenre(source, genre, data, err)
    local ok, apply_err = self:applySearch(source, "", data, err)
    self.mode = "genres"
    self.genre = genre
    return ok, apply_err
end

function Browse:genre(source, genre)
    return self:applyGenre(source, genre, self:fetchGenre(source, genre))
end

function Browse:search(source, query)
    return self:applySearch(source, query, self:fetchSearch(source, query))
end

function Browse:getResults()
    return self.results
end

-- --- Pagination / load more ----------------------------------------------------

-- Callers must gate on hasMore() first, so this is never a wasted request.
function Browse:fetchMore()
    if self.mode == "popular" or self.mode == "latest" then
        return self.api:browse{ source = self.source, mode = self.mode, page = self.page + 1 }
    end
    local opts = { source = self.source, query = self.query or "", page = self.page + 1 }
    if self.mode == "genres" then
        opts.genres = { self.genre.token }
    end
    return self.api:search(opts)
end

-- On error, results and page are kept intact so the caller can retry.
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

function Browse:getMode()
    return self.mode
end

function Browse:getGenre()
    return self.genre
end

function Browse:getPage()
    return self.page
end

function Browse:getError()
    return self.error
end

-- True only when a search succeeded with zero results (not before a search, nor
-- while results or an error are present).
function Browse:isEmpty()
    return self.searched and self.error == nil and #self.results == 0
end

function Browse:hasMore()
    return self.has_next_page
end

return Browse
