-- KRP-506 — logic behind the reader's loading/retry states.
--
-- state/errors.lua is the pure classification of api/client.lua's typed errors
-- (KRP-301): which failures are worth a Retry, and which "error" is really just a
-- user-cancelled loading dialog. It is framework-free so busted drives it with no
-- KOReader loaded (CLAUDE.md §4/§5). The on-panel wording lives in ui/errors.lua
-- (gettext) and is not unit-tested here.
--
-- Typed error shape (KRP-301/302): { kind = "http"|"transport"|"decode"|"build"
-- |"cancelled", status? = <number>, ... }.

local Errors = require("state.errors")

describe("state/errors", function()
    describe("isCancelled", function()
        it("is true only for a cancelled loading dialog", function()
            assert.is_true(Errors.isCancelled{ kind = "cancelled" })
        end)

        it("is false for real failures and for nil", function()
            assert.is_false(Errors.isCancelled(nil))
            assert.is_false(Errors.isCancelled{ kind = "transport" })
            assert.is_false(Errors.isCancelled{ kind = "http", status = 401 })
        end)
    end)

    describe("isRetryable", function()
        it("retries a transport failure (wifi asleep / flaky)", function()
            assert.is_true(Errors.isRetryable{ kind = "transport", message = "asleep" })
        end)

        it("retries a build failure (the server can rebuild)", function()
            assert.is_true(Errors.isRetryable{ kind = "build", status = "failed" })
        end)

        it("retries a server 5xx", function()
            assert.is_true(Errors.isRetryable{ kind = "http", status = 500 })
            assert.is_true(Errors.isRetryable{ kind = "http", status = 503 })
        end)

        it("does NOT retry a 401 (routed to re-auth instead)", function()
            assert.is_false(Errors.isRetryable{ kind = "http", status = 401 })
        end)

        it("does NOT retry other 4xx (e.g. a permanent 404)", function()
            assert.is_false(Errors.isRetryable{ kind = "http", status = 404 })
        end)

        it("does NOT retry a cancelled dialog, a decode error, or nil", function()
            assert.is_false(Errors.isRetryable{ kind = "cancelled" })
            assert.is_false(Errors.isRetryable{ kind = "decode" })
            assert.is_false(Errors.isRetryable(nil))
        end)
    end)
end)
