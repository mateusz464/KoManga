local TrackerAccount = {}
TrackerAccount.__index = TrackerAccount

function TrackerAccount.normalizeAccount(account)
    if not account then
        return nil
    end
    if account.username == "" or account.username == "unknown" then
        local cleaned = {}
        for k, v in pairs(account) do
            cleaned[k] = v
        end
        cleaned.username = nil
        return cleaned
    end
    return account
end

function TrackerAccount.new(api, settings)
    return setmetatable({
        api = api,
        settings = settings,
        linked = false,
        account = nil,
        error = nil,
    }, TrackerAccount)
end

function TrackerAccount.cachedLinked(settings)
    return settings ~= nil and settings:isTrackerLinked()
end

function TrackerAccount.menuLabel(settings)
    if TrackerAccount.cachedLinked(settings) then
        return "Manage AniList"
    end
    return "Link AniList"
end

function TrackerAccount:isLinked()
    return self.linked == true
end

function TrackerAccount:getAccount()
    return self.account
end

function TrackerAccount:getError()
    return self.error
end

function TrackerAccount:fetchAccount()
    return self.api:trackerAccount()
end

function TrackerAccount:applyAccount(data, err)
    if err then
        self.error = err
        return false, err
    end

    self.linked = data ~= nil and data.linked == true
    self.account = self.linked and TrackerAccount.normalizeAccount(data.account) or nil
    self.error = nil
    if self.settings then
        self.settings:setTrackerLinked(self.linked)
    end
    return true, nil
end

function TrackerAccount:fetchUnlink()
    return self.api:trackerUnlink()
end

function TrackerAccount:applyUnlink(_data, err)
    if err then
        self.error = err
        return false, err
    end

    self.linked = false
    self.account = nil
    self.error = nil
    if self.settings then
        self.settings:setTrackerLinked(false)
    end
    return true, nil
end

return TrackerAccount
