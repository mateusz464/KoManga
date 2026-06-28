-- KRP-301 — fake HTTP transport for the API-client spec.
--
-- The api/ client (KRP-302) shapes requests, injects auth, unwraps the { data }
-- envelope, and maps errors, but delegates the actual socket.http/ssl.https call
-- to an injected `transport` function. That function is THE HTTP boundary. The
-- api-client spec is the one place that mocks here (every other logic spec mocks
-- higher up, at the api/ boundary — see spec/support/fake_api.lua, CLAUDE.md §5).
--
-- A transport is a function(request) -> (response | nil, err) where:
--   request  = { method = "GET"|"POST"|"PUT"|"DELETE", url, headers, body }
--   response = { status = <int>, body = <string>, headers = <table> }
--   on a transport-level failure (wifi down, refused, DNS) it returns nil + err.
--
-- FakeTransport.new wraps a handler and records every request it receives so a
-- spec can assert on request shaping; the helpers build common canned responses.

local rapidjson = require("rapidjson")

local FakeTransport = {}

-- handler(request) -> (response | nil, err). Returns the transport function plus
-- a recorder table whose `.requests` array holds every request, in order.
function FakeTransport.new(handler)
    local recorder = { requests = {} }
    local function transport(request)
        recorder.requests[#recorder.requests + 1] = request
        return handler(request)
    end
    return transport, recorder
end

-- A 2xx response carrying `data` in the success envelope, the way the API replies.
function FakeTransport.ok(data, status)
    return function()
        return {
            status = status or 200,
            body = rapidjson.encode({ data = data }),
            headers = {},
        }
    end
end

-- A non-2xx response carrying the API's error envelope { error = { code, message } }.
function FakeTransport.httpError(status, code, message)
    return function()
        return {
            status = status,
            body = rapidjson.encode({ error = { code = code, message = message } }),
            headers = {},
        }
    end
end

-- A transport-level failure: no HTTP response at all (e.g. wifi asleep).
function FakeTransport.failing(err)
    return function()
        return nil, err
    end
end

return FakeTransport
