-- KRP-202 — in-memory stand-in for a LuaSettings store, for testing settings.lua
-- without KOReader loaded (CLAUDE.md §9: inject collaborators). Implements the
-- subset settings.lua uses: readSetting/saveSetting/delSetting/flush, plus a
-- flushes counter so specs can assert persistence was triggered.
local FakeStore = {}
FakeStore.__index = FakeStore

-- data: optional seed table simulating a previously-persisted file.
function FakeStore.new(data)
    return setmetatable({ data = data or {}, flushes = 0 }, FakeStore)
end

function FakeStore:readSetting(key, default)
    local v = self.data[key]
    if v == nil then return default end
    return v
end

function FakeStore:saveSetting(key, value)
    self.data[key] = value
    return self
end

function FakeStore:delSetting(key)
    self.data[key] = nil
    return self
end

function FakeStore:flush()
    self.flushes = self.flushes + 1
    return self
end

return FakeStore
