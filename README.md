# 🍊 Trans Prompt

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/alkemic-studio.trans-prompt?color=007ACC&logo=visual-studio-code&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/alkemic-studio.trans-prompt?color=informational&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/alkemic-studio.trans-prompt?color=orange&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt&ssr=false#review-details)
[![GitHub stars](https://img.shields.io/github/stars/juncha9/trans-prompt?color=f5d90a&logo=github)](https://github.com/juncha9/trans-prompt/stargazers)
[![last commit](https://img.shields.io/github/last-commit/juncha9/trans-prompt?color=blueviolet&logo=github)](https://github.com/juncha9/trans-prompt/commits/main)
[![license](https://img.shields.io/github/license/juncha9/trans-prompt?color=green)](./LICENSE.md)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github-sponsors)](https://github.com/sponsors/juncha9)

**A side-by-side reader for English Markdown — skills, prompts, and agent docs — rendered like a preview, with translation.**

Agent instructions, skill definitions, and system prompts are written in English and read as walls of raw Markdown. Reading them in the editor means parsing `##`, `- **bold**`, and fenced blocks in your head; and for non-native speakers, doing that in a second language on top.

Trans Prompt opens a side panel that renders your `.md` file the way a Markdown preview would — headings, nested lists, tables, code blocks — but in your language. The panel follows the editor as you scroll, and clicking any block jumps the cursor there.

![Usage](https://raw.githubusercontent.com/juncha9/trans-prompt/main/docs/imgs/transprompt_usage.gif)

> The screenshot above is from 1.x and shows the old line-by-line overlay. It will be replaced.

## 🤔 Usage

1. Open any `.md` file in VS Code
2. Set your Google API key via Command Palette (`Ctrl+Shift+P`) → `Trans Prompt: Set Google API Key`
3. Click the 🌐 globe icon in the top-right corner
4. The side panel renders the document — read, scroll, click through
5. Click the ⊘ icon (or close the panel) to turn it off

## 🤗 Features

- 📖 **Rendered, not listed** — Real Markdown structure: heading hierarchy, nested and ordered lists, task list checkboxes, block quotes, GFM tables with column alignment, horizontal rules, and front matter as a collapsible metadata card
- 🎨 **Syntax-highlighted code** — Fenced blocks are highlighted (bash, json, yaml, ts/js, python, sql, diff, xml, and more) using your theme's colors, with a language badge and a copy button
- 🧩 **Structure survives translation** — Only natural language is sent to the translator. Inline code, links and their URLs, file paths, template variables (`{{var}}`, `$ARGUMENTS`), and raw HTML are masked out and restored afterward, so `- **fast** mode: run \`npm i\`` comes back with its markers intact
- 💸 **Fewer characters billed** — Markers, URLs, and code no longer count toward your quota, and lines with no real prose (`` - `--flag`: v1.2.3 ``) skip the API entirely. On the bundled sample this cuts characters sent by more than half
- 🔗 **Two-way navigation** — Scroll the editor and the panel follows; the block under your cursor is highlighted; click a block to jump the editor there (double-click to move focus too)
- ⚡ **Progressive rendering** — Cached content appears immediately and untranslated blocks show the English original, replaced in place as translations arrive. Your scroll position is preserved throughout
- 💾 **Persistent cache** — Translations are cached globally and keyed by content, so editing one paragraph re-translates only that paragraph — the rest stay free even after lines shift
- 🔄 **Per-block reload** — Right-click to drop the cached translation for the block at your cursor and fetch it again
- 🌍 **Multi-language** — Korean, Japanese, Chinese, French, German, Spanish, Russian, and more
- 🔒 **Locked-down panel** — Strict CSP with per-load nonce, no network access from the webview, and unsafe link schemes (`javascript:`, `data:`) are refused

## 🤓 Why Trans Prompt?

- **Minimal API usage** — Translations are cached in VS Code's global storage, keyed by the exact text sent to the API. Repeated phrases, boilerplate instructions, and unchanged blocks cost zero additional calls, even across sessions and across documents.
- **On-demand only** — No background translation. The API is called only when you explicitly enable it. Restoring a panel after a restart renders from cache and makes no requests.
- **Your document is never modified** — Everything happens in the panel; the source file is untouched.

## 📦 Requirements

- **Google Cloud Translation API key** — Get one from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- Enable the **Cloud Translation API** in your Google Cloud project

## 🚀 Getting Started

1. Install the extension
2. Open the Command Palette (`Ctrl+Shift+P`) and run `Trans Prompt: Set Google API Key`
3. Open any `.md` file and click the 🌐 globe icon in the top-right corner

## ⚙️ Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `trans-prompt.target_language` | Target language code (e.g., `ko`, `ja`, `zh-CN`) | `ko` |
| `trans-prompt.google_api_key` | Google Cloud Translation API key | — |

## 📋 Commands

| Command | Description |
|---------|-------------|
| `Trans Prompt: Enable Translation` | Open the reader panel for the current document (🌐 icon) |
| `Trans Prompt: Disable Translation` | Close the panel and stop translating (⊘ icon) |
| `Trans Prompt: Translate Document` | Re-render the current document |
| `Trans Prompt: Reload Translation at Cursor` | Drop the cached translation for the block at the cursor and fetch it again (also via right-click) |
| `Trans Prompt: Clear Translation Cache` | Clear all cached translations |
| `Trans Prompt: Set Target Language` | Select target language from a list |
| `Trans Prompt: Set Google API Key` | Set or update your API key |

## 🧭 Upgrading from 1.x

2.0 replaces the line-by-line overlay with a rendered reader panel. Two things change for existing users:

- **The `right` display mode is gone.** With real Markdown rendering, hierarchy comes from document structure, so `trans-prompt.display_mode`, `trans-prompt.display_gap`, and `trans-prompt.indent_mode` were removed along with their commands.
- **Translation units changed from lines to blocks**, which changes the cache keys. Cached 1.x entries that happen to be plain single-line sentences are reused automatically; the rest are re-translated once.

## 🐞 Known limitations

- Panel scrolling does not drive the editor (the editor drives the panel). Click a block to move the editor.
- Heading anchor links (`#section`) are not navigable yet.
- Images are shown as their alt text rather than loaded.

## 📄 License

MIT
