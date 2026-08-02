# Changelog

## [2.0.0] - 2026-07-27

Trans Prompt is now a **Markdown reader** rather than a line-by-line translation overlay. The side panel renders the document the way a Markdown preview would, in your language.

### ⚠️ Breaking

- **Removed the `right` display mode** and, with it, the `trans-prompt.display_mode`, `trans-prompt.display_gap`, and `trans-prompt.indent_mode` settings plus the `Set Display Mode`, `Set Display Gap`, and `Set Indent Mode` commands. Markdown rendering derives hierarchy from document structure, so manual indent modes no longer have a job.
- **Translation units changed from lines to blocks**, which changes the cache key. 1.x entries that are plain single-line sentences are reused automatically (and migrated forward); the rest are re-translated once.
- `Trans Prompt: Reload This Line Translation` is now `Trans Prompt: Reload Translation at Cursor` and operates on the block at the cursor.

### Added

- **Markdown rendering** — heading hierarchy, nested/ordered lists, task list checkboxes, block quotes, GFM tables with column alignment, horizontal rules, and front matter as a collapsible metadata card
- **Syntax highlighting** for fenced code blocks across 15 languages, mapped onto the active VS Code theme's colors, with a language badge and a copy button
- **Structure-preserving translation** — inline code, link URLs, file paths, template variables (`{{var}}`, `$ARGUMENTS`), and raw HTML are masked before the API call and restored afterward, so Markdown markers survive
- **Editor scroll sync** — the panel now follows the editor's visible range. (1.x documented this but only synced the cursor.)
- **Progressive rendering** — untranslated blocks show the English original and are replaced in place as translations arrive, with scroll position preserved
- **Panel restore** — the panel survives a window restart via `WebviewPanelSerializer` and renders from cache without calling the API
- **Retry and error classification** — 429 and 5xx are retried with backoff; auth and quota failures stop the run and tell you why, instead of filling the document with `(translation error)`
- Unit tests for the parsing, masking, restore, and rendering layers (`npm test`)

### Changed

- **Fewer characters billed** — markers, URLs, and code no longer reach the API, and lines with no real prose skip it entirely. On the bundled sample this cuts characters sent by more than half.
- Body text now uses the UI font instead of the editor's monospace, with `word-break: keep-all` for CJK line breaking
- Single-clicking a panel block keeps focus in the panel; double-click moves focus to the editor
- Build moved from `tsc` to `esbuild` with separate extension and webview bundles

### Fixed

- **Edits made while a translation was in flight could be silently dropped.** The debounce cleared the dirty flag before the run started, so a run that returned early left no record that the document had changed. Replaced with a `document.version`-based run loop that never drops a request.
- **The panel jumped to the top on every keystroke.** Rendering rebuilt the whole DOM; it now patches only the blocks whose content changed and restores the scroll anchor.
- **Settings edited directly in `settings.json` were ignored** — `onDidChangeConfiguration` is now subscribed.
- **Pressing Esc in the API key prompt erased the stored key.** Cancel and "clear the key" are now distinguished.
- `Clear Translation Cache` reported `0 entries` instead of how many it removed.

### Security

- The webview now runs under a strict CSP with a per-load nonce, `default-src 'none'`, and `connect-src 'none'`; styles and scripts load from the extension directory via `asWebviewUri` with `localResourceRoots` set.
- The webview could previously ask the extension to run **any** command by id. That channel is replaced by a fixed set of intents mapped to commands on the extension side.
- Translated text and source Markdown are both HTML-escaped before rendering; `javascript:`/`data:` link schemes are refused.

## [1.5.1] - 2026-04-26

### Fixed
- Restored the usage demo image in the README (moved to a more visible position right under the intro)

## [1.5.0] - 2026-04-26

### Added
- **`trans-prompt.indent_mode` setting** — Choose how panel rows are indented: `source` (default, follows the original line's leading whitespace) or `md_section` (indents by Markdown heading depth: `#`, `##`, `###` …)
- **`Trans Prompt: Set Indent Mode (panel)` command** — Switch between `source` and `md_section` indent modes

### Changed
- Closing the side webview panel (X button) while translation is enabled now also disables translation for the current document, instead of silently leaving translation active without a UI

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
