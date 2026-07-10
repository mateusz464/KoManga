local Completion = require("state.completion")
local FakeApi = require("spec.support.fake_api")

local CHAPTER = "ch9"

local function make()
    local api = FakeApi.new()
    return Completion.new(api, CHAPTER), api
end

describe("Completion (chapter tracker trigger) state", function()
    it("does nothing before the final reader page", function()
        local completion, api = make()

        assert.is_nil(completion:onPageUpdate(6, 7))
        assert.are.equal(0, #api.calls)
    end)

    it("requests completion when the reader reaches the final page", function()
        local completion, api = make()

        local chapter_id = completion:onPageUpdate(7, 7)

        assert.are.equal(CHAPTER, chapter_id)
        assert.are.equal(0, #api.calls)
    end)

    it("fires only once when KOReader repeats final-page updates", function()
        local completion = make()

        assert.are.equal(CHAPTER, completion:onPageUpdate(7, 7))
        assert.is_nil(completion:onPageUpdate(7, 7))
        assert.is_nil(completion:onPageUpdate(6, 7))
        assert.is_nil(completion:onPageUpdate(7, 7))
    end)

    it("does not complete an empty or invalid page range", function()
        local completion = make()

        assert.is_nil(completion:onPageUpdate(1, 0))
        assert.is_nil(completion:onPageUpdate(0, 7))
    end)

    it("sends a completion through the injected API boundary", function()
        local completion, api = make()

        completion:complete()

        assert.are.equal(1, #api.calls)
        assert.are.equal("complete", api.calls[1].method)
        assert.are.equal(CHAPTER, api.calls[1].args[1])
    end)
end)
