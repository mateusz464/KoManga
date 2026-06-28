-- luacheck config for the KoManga plugin (CLAUDE.md §9: luacheck clean).
-- The plugin runs on KOReader's LuaJIT; mirror KOReader's own conventions so
-- framework idioms (implicit `self` on colon-methods, unused widget args) don't
-- read as warnings. Specs additionally get busted's globals.
std = "luajit"
unused_args = false -- KOReader widget callbacks take args they don't all use
self = false        -- ignore implicit self on colon-defined methods

files["spec/"] = { std = "+busted" }
