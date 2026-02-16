# 🍊 Trans Prompt

**Inline translation overlay for prompt engineering in VS Code.**

Prompt engineering demands precision — every word in a system prompt, agent instruction, or skill definition shapes how an LLM behaves. Writing these in English yields the best results (fewer tokens, better model comprehension), but reviewing and refining English prompts can be a bottleneck for non-native speakers.

Trans Prompt solves this by displaying inline translations directly beside each line of your `.md` prompt files. You can verify intent, catch ambiguities, and iterate faster — without leaving the editor or switching context.

## 🤔 Usage

1. Open any `.md` file in VS Code
2. Set your Google API key via Command Palette (`Ctrl+Shift+P`) → `Trans Prompt: Set Google API Key`
3. Click the 🌐 globe icon in the top-right corner of the editor
4. Inline translations appear beside each line — review, refine, and iterate instantly
![Usage](transprompt_usage.gif)

## 🤗 Features

- 🔘 **On-demand translation** — Click the globe icon in the editor title bar to translate the current document
- ⏳ **Loading indicators** — Shows `translating...` placeholders while API calls are in progress
- 💾 **Persistent cache** — Translations are cached globally, so repeated content is instant
- 🔄 **Per-line reload** — Right-click a line to clear its cached translation and re-translate
- 🌍 **Multi-language support** — Korean, Japanese, Chinese, French, German, Spanish, Russian, and more
- 🤖 **Copilot-friendly** — Hides translation overlay on the current editing line to avoid conflicts with GitHub Copilot inline suggestions
- 📐 **Adjustable display gap** — Configure the spacing between original text and translation overlay
- 💬 **Code block comment support** — Translates comments (`//`, `#`, `/* */`) inside fenced code blocks

## 🤓 Why Trans Prompt?

- **Minimal API usage** — Translations are persistently cached via VS Code's global storage. Once a line is translated, it never calls the API again — even across sessions. Repeated phrases, boilerplate instructions, and unchanged lines cost zero additional API calls.
- **On-demand only** — No background translation. The API is called only when you explicitly click the translate button, so you stay in full control of usage.
- **Per-line cache management** — If a translation looks wrong, right-click to reload just that line instead of re-translating the entire document.

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
| `trans-prompt.display_gap` | Gap (in characters) between original text and translation overlay | `8` |
| `trans-prompt.google_api_key` | Google Cloud Translation API key | — |

## 📋 Commands

| Command | Description |
|---------|-------------|
| `Trans Prompt: Translate Document` | Translate the current document (also via globe icon) |
| `Trans Prompt: Reload Line Translation` | Re-translate the current line (also via right-click) |
| `Trans Prompt: Clear Translation Cache` | Clear all cached translations |
| `Trans Prompt: Set Target Language` | Select target language from a list |
| `Trans Prompt: Set Display Gap` | Set gap between original text and translation |
| `Trans Prompt: Set Google API Key` | Set or update your API key |


## 📄 License

MIT
