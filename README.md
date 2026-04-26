# 🍊 Trans Prompt

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/alkemic-studio.trans-prompt?color=007ACC&logo=visual-studio-code&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/alkemic-studio.trans-prompt?color=informational&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt)
[![VS Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/alkemic-studio.trans-prompt?color=orange&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=alkemic-studio.trans-prompt&ssr=false#review-details)
[![GitHub stars](https://img.shields.io/github/stars/juncha9/trans-prompt?color=f5d90a&logo=github)](https://github.com/juncha9/trans-prompt/stargazers)
[![last commit](https://img.shields.io/github/last-commit/juncha9/trans-prompt?color=blueviolet&logo=github)](https://github.com/juncha9/trans-prompt/commits/main)
[![license](https://img.shields.io/github/license/juncha9/trans-prompt?color=green)](./LICENSE.md)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github-sponsors)](https://github.com/sponsors/juncha9)

**Inline translation overlay for prompt engineering in VS Code.**

Prompt engineering demands precision — every word in a system prompt, agent instruction, or skill definition shapes how an LLM behaves. Writing these in English yields the best results (fewer tokens, better model comprehension), but reviewing and refining English prompts can be a bottleneck for non-native speakers.

Trans Prompt solves this by displaying inline translations directly beside each line of your `.md` prompt files. You can verify intent, catch ambiguities, and iterate faster — without leaving the editor or switching context.

## 🤔 Usage

1. Open any `.md` file in VS Code
2. Set your Google API key via Command Palette (`Ctrl+Shift+P`) → `Trans Prompt: Set Google API Key`
3. Click the 🌐 globe icon in the top-right corner to enable translation
4. Inline translations appear beside each line — review, refine, and iterate instantly
5. Click the ⊘ icon to disable translation and clear overlays
![Usage](https://raw.githubusercontent.com/juncha9/trans-prompt/main/docs/imgs/architecture.png)

## 🤗 Features

- 🔘 **Enable/Disable toggle** — Click the globe icon to enable, click again (⊘) to disable and clear overlays
- 🪟 **Two display modes** — `panel` (default): translations in a side webview synced with the editor cursor; `right`: inline translations to the right of each line
- 🎯 **Active-line highlight & jump** — In panel mode, the row matching the editor cursor is highlighted and centered; click any panel row to jump the editor cursor there
- 📑 **Indent modes (panel)** — `source` (default) follows the original whitespace; `md_section` indents by Markdown heading depth (`#`, `##`, `###` …) for a TOC-like outline
- 🔚 **Auto-disable on panel close** — Closing the panel via the X button also disables translation for the current document
- ⏳ **Loading indicators** — Shows `translating...` placeholders while API calls are in progress
- 💾 **Persistent cache** — Translations are cached globally, so repeated content is instant
- 🔄 **Per-line reload** — Right-click a line to clear its cached translation and re-translate
- 🌍 **Multi-language support** — Korean, Japanese, Chinese, French, German, Spanish, Russian, and more
- 🤖 **Copilot-friendly** — In `right` mode, hides translation overlay on the current editing line to avoid conflicts with GitHub Copilot inline suggestions
- 📐 **Adjustable display gap** — Configure the spacing between original text and translation overlay (`right` mode)
- 💬 **Code block comment support** — Translates comments (`//`, `#`, `/* */`) inside fenced code blocks

## 🤓 Why Trans Prompt?

- **Minimal API usage** — Translations are persistently cached via VS Code's global storage. Once a line is translated, it never calls the API again — even across sessions. Repeated phrases, boilerplate instructions, and unchanged lines cost zero additional API calls.
- **On-demand only** — No background translation. The API is called only when you explicitly enable translation, so you stay in full control of usage.
- **Per-line cache management** — If a translation looks wrong, right-click to reload just that line instead of re-translating the entire document.

## 📦 Requirements

- **Google Cloud Translation API key** — Get one from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- Enable the **Cloud Translation API** in your Google Cloud project

## 🚀 Getting Started

1. Install the extension
2. Open the Command Palette (`Ctrl+Shift+P`) and run `Trans Prompt: Set Google API Key`
3. Open any `.md` file and click the 🌐 globe icon in the top-right corner to enable translation

## ⚙️ Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `trans-prompt.target_language` | Target language code (e.g., `ko`, `ja`, `zh-CN`) | `ko` |
| `trans-prompt.display_mode` | How translations are rendered: `panel` (side webview) or `right` (inline to the right) | `panel` |
| `trans-prompt.indent_mode` | Panel row indent: `source` (original whitespace) or `md_section` (Markdown heading depth) | `source` |
| `trans-prompt.display_gap` | Gap (in characters) between original text and translation overlay (used in `right` mode) | `8` |
| `trans-prompt.google_api_key` | Google Cloud Translation API key | — |

## 📋 Commands

| Command | Description |
|---------|-------------|
| `Trans Prompt: Enable Translation` | Enable translation and translate the current document (🌐 icon) |
| `Trans Prompt: Disable Translation` | Disable translation and clear all overlays (⊘ icon) |
| `Trans Prompt: Translate Document` | Re-translate the current document (when enabled) |
| `Trans Prompt: Reload This Line Translation` | Re-translate the current line (also via right-click) |
| `Trans Prompt: Clear Translation Cache` | Clear all cached translations |
| `Trans Prompt: Set Target Language` | Select target language from a list |
| `Trans Prompt: Set Display Mode` | Switch between `panel` and `right` display modes |
| `Trans Prompt: Set Indent Mode (panel)` | Switch panel row indent between `source` and `md_section` |
| `Trans Prompt: Set Display Gap` | Set gap between original text and translation (`right` mode) |
| `Trans Prompt: Set Google API Key` | Set or update your API key |


## 📄 License

MIT
