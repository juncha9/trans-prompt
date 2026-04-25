# Changelog

## [1.4.0] - 2026-04-26

### Added
- **Side webview panel display mode** (new default) — `display_mode: 'panel'` renders translations in a side webview synced with the editor cursor, replacing the right-side overlay as the default
- **Active-line highlight & jump** — In panel mode, the row matching the editor cursor is highlighted and auto-centered; clicking any panel row jumps the editor cursor to that line
- **`Trans Prompt: Set Display Mode` command** — Switch between `panel` and `right` display modes
- **`trans-prompt.display_mode` setting** — `panel` (default) or `right`
- **In-panel "Enable" prompt** — Switching to a non-enabled markdown document while panel is open shows a centered notice with an action button to enable translation for that document

### Fixed
- Active-line highlight no longer leaks to other documents — only syncs when the active editor's document URI matches the panel's document URI
- Webview/terminal focus changes (which fire `onDidChangeActiveTextEditor` with `undefined`) no longer reset internal state, so panel row clicks and the in-panel Enable button work reliably

## [1.3.0] - 2026-04-26

### Added
- **Live re-translation on document edit** — translations now refresh automatically while typing (600ms debounce) instead of waiting for the cursor to move to another line
- **Per-document enabled state** — translation overlay state is preserved per file, so switching tabs no longer requires re-enabling

### Performance
- **Batch translation** — uncached lines in a document are deduplicated and translated in 100-line chunks per API call (previously sequential per-line)
- **In-memory cache with debounced flush** — cache writes are coalesced to a single persistent write, eliminating O(N²) serialization on rapid misses
- Narrowed activation event from `onStartupFinished` to `onLanguage:markdown` to reduce VS Code startup cost

### Fixed
- API key empty-string was not detected (the default `''` slipped past the `== null` check) — now properly validated with a warning
- HTML entities (`&#39;`, `&amp;`, `&quot;`, etc.) returned by Google Translate are now decoded before display and caching

## [1.2.1] - 2026-03-22

### Fixed
- Fixed memory leak: `translationDecorationType` is now properly disposed via `context.subscriptions`
- Fixed bug where decorations reappeared after disabling translation if an async translation was already in progress
- Fixed concurrent `translateDocument()` calls causing duplicate API requests and decoration conflicts

## [1.2.0] - 2026-02-18

### Added
- **Enable/Disable toggle** — Separate `Enable Translation` (🌐) and `Disable Translation` (⊘) commands with toggling title bar icon
- **Translation state guard** — Auto-translation only triggers when explicitly enabled; no more accidental translations on Enter key

### Changed
- `Translate Document` command now only works when translation is enabled
- `Reload This Line Translation` (renamed from `Reload Line Translation`) now re-translates only the current line instead of the entire document
- Inlined `applyDecorations` — each call site now directly manages decoration filtering for clearer context
- Translation state resets when switching editor tabs

### Fixed
- Fixed bug where translation was triggered every time the Enter key was pressed

## [1.1.1] - 2026-02-17

### Fixed
- 🔀 Fixed bug where translation decorations from previous document remained on other files (`.ts`, `.json`, etc.) when switching tabs

### Changed
- Changed to initialize decoration state when switching tabs — translations must be explicitly executed to be displayed
- Added cache hit/miss debug logs (`[trans-prompt]` prefix)
- Improved variable naming: `lastDecorations` → `currentDecorations`

## [1.1.0] - 2026-02-16

### Added
- **Copilot-friendly mode** — Hides translation overlay on the current editing line to prevent conflicts with GitHub Copilot inline suggestions
- **Display gap setting** — Configurable gap (`trans-prompt.display_gap`) between original text and translation overlay (0-40 characters, default: 8)
- **Set Display Gap command** — `Trans Prompt: Set Display Gap` to adjust spacing from the command palette
- **Code block comment support** — Translates comments (`//`, `#`, `/* */`) inside fenced code blocks while skipping non-comment code lines

### Changed
- Translation is now triggered when the cursor moves to a different line (instead of debounce on every keystroke), reducing unnecessary API calls during editing
- Moved `parseParagraphs` to shared utility module (`_utils`)

## [1.0.2] - 2026-02-15

### Changed
- Updated README with usage GIF

## [1.0.1] - 2026-02-15

### Changed
- Updated README

## [1.0.0] - 2026-02-15

### Added
- Initial release
- On-demand inline translation for `.md` files
- Google Cloud Translation API integration
- Persistent translation cache via VS Code global storage
- Per-line cache reload via right-click context menu
- Multi-language support (Korean, Japanese, Chinese, French, German, Spanish, Russian)
- Loading placeholders during translation
