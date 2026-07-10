local CompletionSync = require("ui.completion_sync")
local FakeApi = require("spec.support.fake_api")

local function make(opts)
    opts = opts or {}
    local calls = {}
    local api = FakeApi.new()
    local sync = CompletionSync.new{
        ui = {
            document = {
                getPageCount = function() return opts.page_count or 7 end,
            },
        },
        net = {
            run = function(_, task, run_opts)
                calls[#calls + 1] = { task = task, opts = run_opts }
            end,
        },
        api = api,
    }
    return sync, api, calls
end

local function doc_settings(chapter_id)
    return {
        readSetting = function(_, key)
            if key == "komanga_chapter_id" then
                return chapter_id
            end
        end,
    }
end

describe("CompletionSync (reader event glue)", function()
    it("sends a final-page completion through silent background networking once", function()
        local sync, api, calls = make()
        sync:onReaderReady(doc_settings("ch9"))

        sync:onPageUpdate(6)
        sync:onPageUpdate(7)
        sync:onPageUpdate(7)

        assert.are.equal(1, #calls)
        assert.is_true(calls[1].opts.background)
        calls[1].task()
        assert.are.equal(1, #api.calls)
        assert.are.equal("complete", api.calls[1].method)
        assert.are.equal("ch9", api.calls[1].args[1])
    end)

    it("does nothing for a document without KoManga chapter settings", function()
        local sync, _, calls = make()
        sync:onReaderReady(doc_settings(nil))

        sync:onPageUpdate(7)

        assert.are.equal(0, #calls)
    end)
end)
