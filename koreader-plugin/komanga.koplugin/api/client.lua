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
--
-- When request.sink_path is set the body is streamed straight to that file (an
-- ltn12 file sink) instead of accumulated in memory, so an arbitrarily large
-- download never lives in a Lua string — essential for chapter CBZs, which are
-- tens of MB and would OOM the device if buffered and marshalled (KRP-502). In
-- that mode response.body is nil (the bytes are on disk, not returned).
local function default_transport(request)
    local ltn12 = require("ltn12")
    local headers = {}
    for k, v in pairs(request.headers or {}) do
        headers[k] = v
    end
    if request.body then
        headers["Content-Length"] = tostring(#request.body)
    end

    local chunks, sink
    if request.sink_path then
        local file, open_err = io.open(request.sink_path, "wb")
        if not file then
            return nil, "cannot open sink file: " .. tostring(open_err)
        end
        -- ltn12.sink.file closes the handle when the stream ends (or on error).
        sink = ltn12.sink.file(file)
    else
        chunks = {}
        sink = ltn12.sink.table(chunks)
    end

    local http = request.url:match("^https") and require("ssl.https") or require("socket.http")
    local ok, code = http.request({
        method = request.method,
        url = request.url,
        headers = headers,
        source = request.body and ltn12.source.string(request.body) or nil,
        sink = sink,
    })
    if not ok then
        return nil, tostring(code)
    end
    return { status = code, body = chunks and table.concat(chunks) or nil, headers = {} }
end

-- opts = { base_url, get_credential = function() -> credential|nil, transport? }.
function ApiClient.new(opts)
    return setmetatable({
        base_url = opts.base_url,
        get_credential = opts.get_credential,
        transport = opts.transport or default_transport,
    }, ApiClient)
end

-- Shape and run one request, returning (response, nil) on a 2xx or (nil, err) on a
-- transport failure / non-2xx. This is the shared transport+auth+error stage every
-- method goes through; `_request` decodes the JSON envelope on top of it, while raw
-- byte endpoints (covers, KRP-406) read response.body directly. `body` is a
-- pre-encoded request body; `extra_headers` carries e.g. Content-Type;
-- `sink_path`, when set, streams the response body to that file instead of
-- buffering it (large downloads — KRP-502), leaving response.body nil.
function ApiClient:_send(method, url, body, extra_headers, sink_path)
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
        sink_path = sink_path,
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

    return response, nil
end

-- Shape and run one JSON request, returning (data, nil) | (nil, err): the { data }
-- envelope unwrapped, or a decode error if the 2xx body wasn't decodable JSON.
function ApiClient:_request(method, url, body, extra_headers)
    local response, err = self:_send(method, url, body, extra_headers)
    if not response then
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

-- Capture the display title at follow time (API-908) so the library list can label
-- the row by name; it is optional, so a title-less follow still succeeds.
function ApiClient:follow(mangaId, addedAt, title)
    local url = join_url(self.base_url, "/api/library/" .. mangaId)
    local body = { addedAt = addedAt }
    if type(title) == "string" and title ~= "" then
        body.title = title
    end
    return self:_request("PUT", url, rapidjson.encode(body), JSON_HEADERS)
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

-- Cover thumbnail (KRP-406). The server negotiates the profile and produces the
-- eink rendition; this client only ever asks for eink (§6, mirroring pageImageUrl).
function ApiClient:coverImageUrl(mangaId)
    return join_url(self.base_url, "/api/manga/" .. mangaId .. "/cover?profile=eink")
end

-- Fetch a cover's raw image bytes (not the JSON envelope — this endpoint serves the
-- image directly). Returns (bytes, nil) on success or (nil, err) with the same
-- transport/http error shape as every other call, so a missing cover (e.g. 404) is
-- an ordinary error the caller degrades to text on (KRP-406).
function ApiClient:fetchCover(mangaId)
    local response, err = self:_send("GET", self:coverImageUrl(mangaId))
    if not response then
        return nil, err
    end
    return response.body, nil
end

-- Download a chapter's built eink CBZ (KRP-502) straight to `destPath`, returning
-- (destPath, nil) on success or (nil, err). Unlike fetchCover, a chapter CBZ is far
-- too large to return as a string: reader_launcher runs this inside net.lua's forked
-- subprocess, and marshalling tens of MB back through the pipe OOMs the device
-- (the child's buffer.encode fails → caller gets nil → the reader never opens).
-- Streaming to a file (sink_path) keeps the bytes on disk the whole way; only the
-- small path crosses the pipe, and the parent hands that file to ReaderUI. A
-- failure removes any partial file so a retry starts clean. URL is the eink-only
-- cbzUrl builder (§6).
function ApiClient:downloadChapterCbzToFile(chapterId, destPath)
    local response, err = self:_send("GET", self:cbzUrl(chapterId), nil, nil, destPath)
    if not response then
        os.remove(destPath)
        return nil, err
    end
    return destPath, nil
end

-- Transient read path (KRP-606): the URL for a chapter's eink CBZ built and served
-- straight from the server's session cache, WITHOUT persisting a download record —
-- so plain reading never appears under "Downloaded" (only the explicit POST
-- /download does, ui/reader_menu.lua). Always eink (§6), mirroring cbzUrl.
function ApiClient:readCbzUrl(chapterId)
    return join_url(self.base_url, "/api/chapter/" .. chapterId .. "/cbz?profile=eink")
end

-- Fetch a chapter's transient eink CBZ (KRP-606) straight to `destPath`, returning
-- (destPath, nil) or (nil, err). Same streaming-to-file rationale as
-- downloadChapterCbzToFile (a CBZ is far too large to marshal back through
-- net.lua's fork), but it hits the transient read endpoint so reading a chapter
-- does not create a persisted download.
function ApiClient:readChapterCbzToFile(chapterId, destPath)
    local response, err = self:_send("GET", self:readCbzUrl(chapterId), nil, nil, destPath)
    if not response then
        os.remove(destPath)
        return nil, err
    end
    return destPath, nil
end

return ApiClient
