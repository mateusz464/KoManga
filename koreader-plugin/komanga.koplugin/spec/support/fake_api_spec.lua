-- KRP-103 — proves the api-boundary mock pattern works end-to-end.
-- This stands in for a real state-module spec until those modules exist: it
-- shows a consumer being handed the fake client (dependency injection) and the
-- spec inspecting the recorded calls — the pattern every state/ spec will use.
local FakeApi = require("spec.support.fake_api")

-- A stand-in for a future state/ module: pure logic that takes an ApiClient and
-- never touches the network itself.
local function search_titles(api, query)
    local res = api:search(query)
    local titles = {}
    for _, m in ipairs(res.data) do
        table.insert(titles, m.title)
    end
    return titles
end

describe("api-boundary mock pattern", function()
    it("injects canned responses and records calls", function()
        local api = FakeApi.new{
            search = { data = { { title = "Berserk" }, { title = "Vinland Saga" } } },
        }

        local titles = search_titles(api, "saga")

        assert.are.same({ "Berserk", "Vinland Saga" }, titles)
        assert.are.equal(1, #api.calls)
        assert.are.equal("search", api.calls[1].method)
        assert.are.equal("saga", api.calls[1].args[1])
    end)

    it("supports function responses for per-arg behaviour", function()
        local api = FakeApi.new{
            getManga = function(id) return { data = { id = id } } end,
        }

        assert.are.equal(42, api:getManga(42).data.id)
    end)

    it("returns nil for unconfigured methods but still records the call", function()
        local api = FakeApi.new()

        assert.is_nil(api:pushProgress(7, 3))
        assert.are.equal("pushProgress", api.calls[1].method)
        assert.are.same({ 7, 3 }, api.calls[1].args)
    end)
end)
