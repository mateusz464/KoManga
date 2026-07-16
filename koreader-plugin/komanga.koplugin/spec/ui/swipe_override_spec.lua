-- KOM-159 — the swipe→page-turn mapping used by the reader swipe override.
local SwipeOverride = require("ui.swipe_override")

describe("SwipeOverride.turnFor", function()
    it("maps a left → right (east) swipe to the next page when enabled", function()
        assert.are.equal(1, SwipeOverride.turnFor("east", true))
    end)

    it("maps a right → left (west) swipe to the previous page when enabled", function()
        assert.are.equal(-1, SwipeOverride.turnFor("west", true))
    end)

    it("falls through when the preference is off", function()
        assert.is_nil(SwipeOverride.turnFor("east", false))
        assert.is_nil(SwipeOverride.turnFor("west", false))
    end)

    it("falls through for non-horizontal swipes so menus keep working", function()
        assert.is_nil(SwipeOverride.turnFor("north", true))
        assert.is_nil(SwipeOverride.turnFor("south", true))
        assert.is_nil(SwipeOverride.turnFor("northeast", true))
    end)
end)
