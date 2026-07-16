# KOReader emulator integration specs

These tracked specs exercise KoManga against KOReader's real `ReaderUI`,
`UIManager`, widgets, document sidecars, and touch-zone dispatch. They are kept
outside `komanga.koplugin/spec/` because they require the full KOReader runtime;
the plugin's own spec directory remains the pure-Lua unit suite.

`koreader-plugin/.emulator/` is a disposable, gitignored checkout of upstream
KOReader. `run.sh` copies the tracked specs into that checkout before every run,
then passes only the selected files to `kodev`. Edit the files in this directory,
never the staged copies under `.emulator/src/spec/unit/`.

```sh
koreader-plugin/spec/emulator/run.sh
koreader-plugin/spec/emulator/run.sh --lint
koreader-plugin/spec/emulator/run.sh komanga_swipe_kom159_spec.lua
koreader-plugin/spec/emulator/run.sh --live
```

The default suite excludes `komanga_next_chapter_kom160_live_spec.lua`, which
needs a reachable local KoManga API and skips when it is unavailable.
