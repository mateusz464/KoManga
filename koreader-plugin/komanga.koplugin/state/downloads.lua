-- Pure state behind offline downloads (RFC §5.4): the device-local INDEX of built
-- eink CBZs, so the "Downloaded" list renders and opens with wifi off. The store and
-- CBZ directory are injected so no DataStorage/LuaSettings coupling leaks into the
-- pure module; Downloads.open() is the runtime factory, Downloads.new the injectable one.
--
-- The CBZ location, <DataStorage:getDataDir()>/komanga/downloads/<sanitised id>.cbz,
-- is the same path ui/reader_launcher.lua streams to, so a read-then-downloaded
-- chapter reuses its file.
local Downloads = {}
Downloads.__index = Downloads

local KEY_INDEX = "komanga_downloads_index"

function Downloads.new(store, downloadDir)
    local self = setmetatable({
        store = store,
        dir = downloadDir,
        entries = {}, -- insertion order (the list() contract)
        index = {},   -- chapterId -> entry, for O(1) get/has/idempotency
    }, Downloads)
    for _, e in ipairs(store:readSetting(KEY_INDEX) or {}) do
        self.entries[#self.entries + 1] = e
        self.index[e.chapterId] = e
    end
    return self
end

-- A chapter id can be an opaque source-prefixed string; sanitise it to a safe single
-- filesystem segment. Matches reader_launcher.lua so both paths name the same file.
function Downloads.fileNameFor(chapterId)
    return tostring(chapterId):gsub("[^%w%-_]", "_") .. ".cbz"
end

function Downloads:pathFor(chapterId)
    return self.dir .. "/" .. Downloads.fileNameFor(chapterId)
end

function Downloads:has(chapterId)
    return self.index[chapterId] ~= nil
end

function Downloads:get(chapterId)
    return self.index[chapterId]
end

function Downloads:list()
    return self.entries
end

-- Idempotent per chapterId: adding an already-indexed chapter is a no-op.
function Downloads:add(entry)
    if self.index[entry.chapterId] then
        return
    end
    self.entries[#self.entries + 1] = entry
    self.index[entry.chapterId] = entry
    self:persist()
end

-- Returns the local CBZ path the caller must unlink to free storage (nil when the
-- chapter was not indexed).
function Downloads:remove(chapterId)
    if not self.index[chapterId] then
        return nil
    end
    self.index[chapterId] = nil
    for i, e in ipairs(self.entries) do
        if e.chapterId == chapterId then
            table.remove(self.entries, i)
            break
        end
    end
    self:persist()
    return self:pathFor(chapterId)
end

function Downloads:persist()
    self.store:saveSetting(KEY_INDEX, self.entries)
    self.store:flush()
end

-- Lazily requires KOReader so the module stays importable under busted.
function Downloads.open()
    local DataStorage = require("datastorage")
    local LuaSettings = require("luasettings")
    local store = LuaSettings:open(DataStorage:getSettingsDir() .. "/komanga_downloads.lua")
    local dir = DataStorage:getDataDir() .. "/komanga/downloads"
    return Downloads.new(store, dir)
end

-- Runtime only (the coordinator calls it before writing bytes); pure specs never do.
function Downloads:ensureDir()
    require("util").makePath(self.dir)
    return self.dir
end

return Downloads
