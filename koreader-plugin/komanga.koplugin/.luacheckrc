-- luacheck config for the KoManga plugin (CLAUDE.md §9: luacheck clean).
-- The plugin runs on KOReader's LuaJIT; specs add busted's globals.
std = "luajit"
files["spec/"] = { std = "+busted" }
