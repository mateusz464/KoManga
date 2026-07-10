-- Pure state behind AniList account linking. UI runs fetch* methods through
-- net.lua; apply* mutates this table parent-side and schedules bounded polling.
local TrackerLink = {}
TrackerLink.__index = TrackerLink

local DEFAULT_POLL_INTERVAL_SECONDS = 3

local function default_clock()
    local UIManager = require("ui/uimanager")
    return {
        after = function(_, seconds, callback)
            UIManager:scheduleIn(seconds, callback)
            return callback
        end,
        cancel = function(_, handle)
            UIManager:unschedule(handle)
        end,
    }
end

function TrackerLink.new(api, opts)
    opts = opts or {}
    return setmetatable({
        api = api,
        clock = opts.clock or default_clock(),
        poll_interval_seconds = opts.poll_interval_seconds or DEFAULT_POLL_INTERVAL_SECONDS,
        on_poll = opts.on_poll,
        settings = opts.settings,
        status = "idle",
        session_id = nil,
        qr_url = nil,
        qr_bytes = nil,
        account = nil,
        error = nil,
        poll_handle = nil,
    }, TrackerLink)
end

function TrackerLink:getStatus()
    return self.status
end

function TrackerLink:getSessionId()
    return self.session_id
end

function TrackerLink:getQrUrl()
    return self.qr_url
end

function TrackerLink:getQrBytes()
    return self.qr_bytes
end

function TrackerLink:getAccount()
    return self.account
end

function TrackerLink:getError()
    return self.error
end

function TrackerLink:canRestart()
    return self.status == "expired" or self.status == "cancelled"
end

function TrackerLink:fetchStart()
    return self.api:linkStart()
end

function TrackerLink:applyStart(data, err)
    if err then
        self.status = "idle"
        self.error = err
        return false, err
    end
    self:cancelPoll()
    self.status = "pending"
    self.session_id = data.sessionId
    self.qr_url = data.qrUrl
    self.qr_bytes = nil
    self.account = nil
    self.error = nil
    self:schedulePoll()
    return true, nil
end

function TrackerLink:start()
    return self:applyStart(self:fetchStart())
end

function TrackerLink:fetchQr()
    if not self.session_id then
        return nil, { kind = "idle" }
    end
    return self.api:fetchLinkQr(self.session_id)
end

function TrackerLink:applyQr(bytes, err)
    if err then
        self.error = err
        return false, err
    end
    self.qr_bytes = bytes
    self.error = nil
    return true, nil
end

function TrackerLink:fetchStatus()
    if not self.session_id then
        return nil, { kind = "idle" }
    end
    return self.api:linkStatus(self.session_id)
end

function TrackerLink:applyStatus(data, err)
    if self.status ~= "pending" then
        return false, nil
    end

    if err then
        self.error = err
        self:schedulePoll()
        return false, err
    end

    local status = data and data.status
    if status == "linked" then
        self.status = "linked"
        self.account = data.account
        self.error = nil
        if self.settings then
            self.settings:setTrackerLinked(true)
        end
        self:cancelPoll()
        return true, nil
    elseif status == "expired" then
        self.status = "expired"
        self.error = nil
        self:cancelPoll()
        return true, nil
    end

    self.status = "pending"
    self.error = nil
    self:schedulePoll()
    return true, nil
end

function TrackerLink:cancel()
    self.status = "cancelled"
    self:cancelPoll()
end

function TrackerLink:schedulePoll()
    if self.status ~= "pending" then
        return
    end
    self.poll_handle = self.clock:after(self.poll_interval_seconds, function()
        if self.status ~= "pending" then
            return
        end
        if self.on_poll then
            self.on_poll(self)
            return
        end
        self:applyStatus(self:fetchStatus())
    end)
end

function TrackerLink:cancelPoll()
    if self.poll_handle then
        self.clock:cancel(self.poll_handle)
        self.poll_handle = nil
    end
end

return TrackerLink
