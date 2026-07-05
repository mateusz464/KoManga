-- KRP-802 — Device-local download store & index (impl). The pure, framework-free
-- state behind offline downloads (RFC §5.4): "download for offline" persists the
-- built eink CBZ on the Kobo and records a device-local index so the "Downloaded"
-- list renders and opens with wifi off. This module owns only the INDEX; the
-- coordinator (KRP-803/804) writes the CBZ bytes to pathFor(id) and the launcher
-- (KRP-806) reads them back.
--
-- Persistence is injected (a LuaSettings-like store, mirroring settings.lua), and
-- the on-device CBZ directory is injected too, so no DataStorage/LuaSettings
-- coupling leaks into the pure module and busted drives it with no KOReader loaded
-- (CLAUDE.md §5/§9). Downloads.open() is the KOReader-runtime factory that wires the
-- real store and data-dir layout; specs use Downloads.new with a fake store.
--
-- The device-local download location is the plugin's data dir,
-- <DataStorage:getDataDir()>/komanga/downloads/<sanitised chapterId>.cbz — the same
-- path the transient reader (ui/reader_launcher.lua) streams to, so a chapter that
-- was read and then downloaded reuses its file.
local Downloads = {}
Downloads.__index = Downloads

-- Namespaced under the plugin so it never collides in a shared store, and distinct
-- from the settings file (settings.lua). Holds the entry array in insertion order.
local KEY_INDEX = "komanga_downloads_index"

-- store: any object exposing LuaSettings' readSetting/saveSetting/flush.
-- downloadDir: the on-device directory the CBZ files live in (injected, not derived,
-- so the module stays KOReader-free).
function Downloads.new(store, downloadDir)
    local self = setmetatable({
        store = store,
        dir = downloadDir,
        entries = {}, -- entry array in insertion order (the list() contract)
        index = {},   -- chapterId -> entry, for O(1) get/has/idempotency
    }, Downloads)
    for _, e in ipairs(store:readSetting(KEY_INDEX) or {}) do
        self.entries[#self.entries + 1] = e
        self.index[e.chapterId] = e
    end
    return self
end

-- The CBZ filename for a chapter: a chapter id can be an opaque source-prefixed
-- string, so sanitise it to a safe single filesystem segment (no path separators).
-- Matches ui/reader_launcher.lua's scheme so the download and transient-read paths
-- name the same file.
function Downloads.fileNameFor(chapterId)
    return tostring(chapterId):gsub("[^%w%-_]", "_") .. ".cbz"
end

-- The full on-device path of a chapter's CBZ under the injected download dir.
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

-- Record a download. Idempotent per chapterId: adding an already-indexed chapter is
-- a no-op (the coordinator treats a re-download as success, KRP-803).
function Downloads:add(entry)
    if self.index[entry.chapterId] then
        return
    end
    self.entries[#self.entries + 1] = entry
    self.index[entry.chapterId] = entry
    self:persist()
end

-- Drop a chapter's index entry, returning the local CBZ path the caller must unlink
-- to free storage (nil when the chapter was not indexed).
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

-- Runtime factory: wire the plugin's own LuaSettings manifest and the on-device CBZ
-- directory. Lazily requires KOReader modules so the module stays importable under
-- busted (mirrors settings.lua's Settings.open).
function Downloads.open()
    local DataStorage = require("datastorage")
    local LuaSettings = require("luasettings")
    local store = LuaSettings:open(DataStorage:getSettingsDir() .. "/komanga_downloads.lua")
    local dir = DataStorage:getDataDir() .. "/komanga/downloads"
    return Downloads.new(store, dir)
end

-- Lazily create the on-device CBZ directory (KOReader runtime only — the pure module
-- and its specs never call this). The coordinator calls it before writing bytes.
function Downloads:ensureDir()
    require("util").makePath(self.dir)
    return self.dir
end

return Downloads
