-- The typed-ish REST client and the ONLY place HTTP lives (CLAUDE.md §5). The
-- socket call is delegated to an injected `transport` so the rest of the app — and
-- busted — never touch it; the runtime default wires socket.http/ssl.https + ltn12.
--
-- Method contract: (data, nil) on success or (nil, err) on failure, where
-- err.kind ∈ "http" (err.status, err.code) | "transport" | "decode".
local rapidjson = require("rapidjson")

local ApiClient = {}
ApiClient.__index = ApiClient

local function urlencode(value)
    return (tostring(value):gsub("[^%w%-_%.~]", function(c)
        return string.format("%%%02X", string.byte(c))
    end))
end

-- Join a (possibly trailing-slash) base URL with an absolute path, no double slash.
local function join_url(base, path)
    if base:sub(-1) == "/" then
        base = base:sub(1, -2)
    end
    return base .. path
end

-- Tolerates both nil-returning and error-raising codecs.
local function decode_json(body)
    local ok, decoded = pcall(rapidjson.decode, body)
    if not ok then
        return nil
    end
    return decoded
end

-- Real HTTP round-trip via luasocket; lazily required so the module imports under busted.
--
-- When request.sink_path is set the body is streamed straight to that file instead
-- of accumulated in memory, so an arbitrarily large download never lives in a Lua
-- string — essential for chapter CBZs (tens of MB), which would OOM the device if
-- buffered and marshalled. In that mode response.body is nil.
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

-- The shared transport+auth+error stage every method goes through, returning
-- (response, nil) on a 2xx or (nil, err) otherwise. `_request` decodes the JSON
-- envelope on top of it; raw-byte endpoints (covers, CBZs) read response.body
-- directly. When set, `sink_path` streams the response to that file (large
-- downloads) leaving response.body nil.
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

-- Unwraps the { data } envelope, or a decode error if the 2xx body wasn't JSON.
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

-- eink only, never raw (CLAUDE.md §6) — as with every image/CBZ path below.
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

-- The optional title labels the library row by name; a title-less follow still succeeds.
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

function ApiClient:linkStart()
    return self:_request("POST", join_url(self.base_url, "/api/tracker/anilist/link"))
end

function ApiClient:linkStatus(sessionId)
    return self:_request(
        "GET",
        join_url(self.base_url, "/api/tracker/anilist/link/" .. sessionId .. "/status")
    )
end

function ApiClient:trackerCandidates(mangaId)
    return self:_request("GET", join_url(self.base_url, "/api/tracker/manga/" .. mangaId .. "/candidates"))
end

function ApiClient:setTrackerMatch(mangaId, mediaId)
    local url = join_url(self.base_url, "/api/tracker/manga/" .. mangaId .. "/match")
    return self:_request("PUT", url, rapidjson.encode({ mediaId = mediaId }), JSON_HEADERS)
end

function ApiClient:clearTrackerMatch(mangaId)
    return self:_request("DELETE", join_url(self.base_url, "/api/tracker/manga/" .. mangaId .. "/match"))
end

function ApiClient:doNotTrack(mangaId)
    return self:_request("POST", join_url(self.base_url, "/api/tracker/manga/" .. mangaId .. "/do-not-track"))
end

function ApiClient:trackerStatus(mangaId)
    return self:_request("GET", join_url(self.base_url, "/api/tracker/manga/" .. mangaId .. "/status"))
end

function ApiClient:complete(chapterId)
    local url = join_url(self.base_url, "/api/tracker/complete")
    return self:_request("POST", url, rapidjson.encode({ chapterId = chapterId }), JSON_HEADERS)
end

function ApiClient:pageImageUrl(pageId)
    return join_url(self.base_url, "/api/page/" .. pageId .. "?profile=eink")
end

function ApiClient:cbzUrl(chapterId)
    return join_url(self.base_url, "/api/downloads/" .. chapterId)
end

function ApiClient:coverImageUrl(mangaId)
    return join_url(self.base_url, "/api/manga/" .. mangaId .. "/cover?profile=eink")
end

function ApiClient:linkQrUrl(sessionId)
    return join_url(self.base_url, "/api/tracker/anilist/link/" .. sessionId .. "/qr.png")
end

-- Raw image bytes, not the JSON envelope. A missing cover (404) is an ordinary
-- error, which the caller degrades to text on.
function ApiClient:fetchCover(mangaId)
    local response, err = self:_send("GET", self:coverImageUrl(mangaId))
    if not response then
        return nil, err
    end
    return response.body, nil
end

-- Raw PNG bytes, not the JSON envelope. The endpoint is protected like the rest
-- of the tracker-link flow, so it goes through the same auth/error stage.
function ApiClient:fetchLinkQr(sessionId)
    local response, err = self:_send("GET", self:linkQrUrl(sessionId))
    if not response then
        return nil, err
    end
    return response.body, nil
end

-- Streams a chapter's built CBZ to `destPath` rather than returning bytes: this
-- runs inside net.lua's forked subprocess, and marshalling tens of MB back through
-- the pipe OOMs the device. Only the path crosses the pipe. A failure removes any
-- partial file so a retry starts clean.
function ApiClient:downloadChapterCbzToFile(chapterId, destPath)
    local response, err = self:_send("GET", self:cbzUrl(chapterId), nil, nil, destPath)
    if not response then
        os.remove(destPath)
        return nil, err
    end
    return destPath, nil
end

-- Transient read path (KRP-606): served from the server's session cache WITHOUT
-- persisting a download record, so plain reading never appears under "Downloaded"
-- (only the explicit POST /download does).
function ApiClient:readCbzUrl(chapterId)
    return join_url(self.base_url, "/api/chapter/" .. chapterId .. "/cbz?profile=eink")
end

-- Same streaming-to-file rationale as downloadChapterCbzToFile, but hits the
-- transient read endpoint so reading a chapter creates no persisted download.
function ApiClient:readChapterCbzToFile(chapterId, destPath)
    local response, err = self:_send("GET", self:readCbzUrl(chapterId), nil, nil, destPath)
    if not response then
        os.remove(destPath)
        return nil, err
    end
    return destPath, nil
end

return ApiClient
