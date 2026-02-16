# Changelog

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
