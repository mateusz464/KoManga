-- LuaSettings-backed persistence (CLAUDE.md §5): the single API credential plus
-- any user overrides of the config knobs. The logic is pure over an injected
-- store (CLAUDE.md §9: pass collaborators in), so busted can test it with a fake
-- store and no KOReader loaded. Settings.open() is the KOReader-runtime factory
-- that wires a real LuaSettings file; main.lua uses it, specs use Settings.new.
local Config = require("config")

local Settings = {}
Settings.__index = Settings

-- Keys are namespaced under the plugin so they never collide in a shared store.
local KEY_CREDENTIAL = "komanga_credential"
local KEY_API_BASE_URL = "komanga_api_base_url"
local KEY_PREFETCH_WINDOW = "komanga_prefetch_window"
local KEY_PROGRESS_DEBOUNCE = "komanga_progress_debounce_seconds"

-- store: any object exposing LuaSettings' readSetting/saveSetting/delSetting/flush.
function Settings.new(store)
    return setmetatable({ store = store }, Settings)
end

-- Runtime factory: open the plugin's own LuaSettings file under the settings dir.
-- Lazily requires KOReader modules so the module stays importable under busted.
function Settings.open()
    local DataStorage = require("datastorage")
    local LuaSettings = require("luasettings")
    local path = DataStorage:getSettingsDir() .. "/komanga.lua"
    return Settings.new(LuaSettings:open(path))
end

function Settings:getCredential()
    return self.store:readSetting(KEY_CREDENTIAL)
end

function Settings:setCredential(credential)
    self.store:saveSetting(KEY_CREDENTIAL, credential)
    self.store:flush()
end

function Settings:getApiBaseUrl()
    return self.store:readSetting(KEY_API_BASE_URL) or Config.api_base_url
end

function Settings:setApiBaseUrl(url)
    self.store:saveSetting(KEY_API_BASE_URL, url)
    self.store:flush()
end

function Settings:getPrefetchWindow()
    return self.store:readSetting(KEY_PREFETCH_WINDOW) or Config.prefetch_window
end

function Settings:getProgressDebounceSeconds()
    return self.store:readSetting(KEY_PROGRESS_DEBOUNCE) or Config.progress_debounce_seconds
end

return Settings
