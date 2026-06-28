-- KRP-302 — API client (impl). The typed-ish REST client and the ONLY place HTTP
-- lives (CLAUDE.md §5). It shapes per-endpoint requests, injects the single
-- credential as a Bearer header (read per request, never cached), unwraps the
-- API's { data } success envelope into plugin-domain tables, and maps failures to
-- typed errors. The actual socket call is delegated to an injected `transport`
-- (the HTTP boundary, KRP-301) so the rest of the app — and busted — never touch
-- transport; the runtime default wires socket.http/ssl.https + ltn12.
--
-- Method contract: a request method returns (data, nil) on success or (nil, err)
-- on failure, where err.kind ∈ "http" (err.status, err.code) | "transport" |
-- "decode". URL builders (pageImageUrl/cbzUrl) are pure and make no request.
local rapidjson = require("rapidjson")

local ApiClient = {}
ApiClient.__index = ApiClient

-- Percent-encode a query value: escape everything outside the unreserved set so
-- spaces and reserved chars (& = ? …) can't break query parsing.
local function urlencode(value)
    return (tostring(value):gsub("[^%w%-_%.~]", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

-- Join the (possibly trailing-slash) base URL with an absolute path, no double slash.
local function join_url(base, path)
    if base:sub(-1) == "/" then
        base = base:sub(1, -2)
    end
    return base .. path
end

-- Decode a JSON body, tolerating both nil-returning and error-raising codecs.
local function decode_json(body)
    local ok, decoded = pcall(rapidjson.decode, body)
    if not ok then
        return nil
    end
    return decoded
end

-- Runtime transport: a real HTTP round-trip via luasocket. Lazily required so the
-- module imports cleanly under busted (specs inject their own transport).
local function default_transport(request)
    local ltn12 = require("ltn12")
    local headers = {}
    for k, v in pairs(request.headers or {}) do
        headers[k] = v
    end
    if request.body then
        headers["Content-Length"] = tostring(#request.body)
    end
    local chunks = {}
    local http = request.url:match("^https") and require("ssl.https") or require("socket.http")
    local ok, code = http.request({
        method = request.method,
        url = request.url,
        headers = headers,
        source = request.body and ltn12.source.string(request.body) or nil,
        sink = ltn12.sink.table(chunks),
    })
    if not ok then
        return nil, tostring(code)
    end
    return { status = code, body = table.concat(chunks), headers = {} }
end

-- opts = { base_url, get_credential = function() -> credential|nil, transport? }.
function ApiClient.new(opts)
    return setmetatable({
        base_url = opts.base_url,
        get_credential = opts.get_credential,
        transport = opts.transport or default_transport,
    }, ApiClient)
end

-- Shape and run one request, returning (data, nil) | (nil, err). `body` is a
-- pre-encoded JSON string; `extra_headers` carries e.g. Content-Type.
function ApiClient:_request(method, url, body, extra_headers)
    local headers = {}
    if extra_headers then
        for k, v in pairs(extra_headers) do
            headers[k] = v
        end
    end
    -- Per-request, never cached: a credential set after construction still applies.
    local credential = self.get_credential and self.get_credential()
    if credential then
        headers["Authorization"] = "Bearer " .. credential
    end

    local response, transport_err = self.transport({
        method = method,
        url = url,
        headers = headers,
        body = body,
    })
    if not response then
        return nil, { kind = "transport", message = transport_err or "transport failure" }
    end

    if response.status < 200 or response.status >= 300 then
        local err = { kind = "http", status = response.status }
        local decoded = decode_json(response.body)
        if type(decoded) == "table" and type(decoded.error) == "table" then
            err.code = decoded.error.code
            err.message = decoded.error.message
        end
        return nil, err
    end

    local decoded = decode_json(response.body)
    if type(decoded) ~= "table" then
        return nil, { kind = "decode", message = "could not decode response body" }
    end
    return decoded.data, nil
end

local JSON_HEADERS = { ["Content-Type"] = "application/json" }

function ApiClient:listSources()
    return self:_request("GET", join_url(self.base_url, "/api/sources"))
end

-- opts = { source, query, page? }.
function ApiClient:search(opts)
    local params = {
        "q=" .. urlencode(opts.query),
        "source=" .. urlencode(opts.source),
    }
    if opts.page then
        params[#params + 1] = "page=" .. urlencode(opts.page)
    end
    return self:_request("GET", join_url(self.base_url, "/api/search?" .. table.concat(params, "&")))
end

function ApiClient:getManga(mangaId)
    return self:_request("GET", join_url(self.base_url, "/api/manga/" .. mangaId))
end

function ApiClient:getChapterPages(chapterId)
    return self:_request("GET", join_url(self.base_url, "/api/chapter/" .. chapterId .. "/pages"))
end

-- This client only ever builds eink CBZs (CLAUDE.md §6); never the raw profile.
function ApiClient:downloadChapter(chapterId, mangaId)
    local path = "/api/chapter/" .. chapterId .. "/download?mangaId=" .. urlencode(mangaId) .. "&profile=eink"
    return self:_request("POST", join_url(self.base_url, path))
end

function ApiClient:listDownloads()
    return self:_request("GET", join_url(self.base_url, "/api/downloads"))
end

function ApiClient:getProgress(mangaId)
    return self:_request("GET", join_url(self.base_url, "/api/progress/" .. mangaId))
end

function ApiClient:putProgress(mangaId, progress)
    local url = join_url(self.base_url, "/api/progress/" .. mangaId)
    return self:_request("PUT", url, rapidjson.encode(progress), JSON_HEADERS)
end

function ApiClient:listLibrary()
    return self:_request("GET", join_url(self.base_url, "/api/library"))
end

function ApiClient:follow(mangaId, addedAt)
    local url = join_url(self.base_url, "/api/library/" .. mangaId)
    return self:_request("PUT", url, rapidjson.encode({ addedAt = addedAt }), JSON_HEADERS)
end

function ApiClient:unfollow(mangaId)
    return self:_request("DELETE", join_url(self.base_url, "/api/library/" .. mangaId))
end

-- Pure URL builders: page images and downloaded CBZ bytes. Always eink (§6).
function ApiClient:pageImageUrl(pageId)
    return join_url(self.base_url, "/api/page/" .. pageId .. "?profile=eink")
end

function ApiClient:cbzUrl(chapterId)
    return join_url(self.base_url, "/api/downloads/" .. chapterId)
end

return ApiClient
