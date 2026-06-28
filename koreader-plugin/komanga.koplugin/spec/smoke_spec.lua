-- KRP-103 — trivial logic spec proving the busted harness runs.
-- Real logic specs (state/, api/) arrive with their feature tickets; this one
-- only exercises pure Lua, with no KOReader runtime loaded.
describe("test harness", function()
    it("runs a trivial assertion", function()
        assert.are.equal(2, 1 + 1)
    end)
end)
