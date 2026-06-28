-- KRP-202 — config returns the API base + tuning knobs (CLAUDE.md §5).
local Config = require("config")

describe("config", function()
    it("exposes an API base URL", function()
        assert.is_string(Config.api_base_url)
        assert.is_truthy(Config.api_base_url:match("^https?://"))
    end)

    it("exposes a bounded prefetch window", function()
        assert.is_number(Config.prefetch_window)
        assert.is_true(Config.prefetch_window > 0)
    end)

    it("exposes a progress-debounce interval in seconds", function()
        assert.is_number(Config.progress_debounce_seconds)
        assert.is_true(Config.progress_debounce_seconds > 0)
    end)
end)
