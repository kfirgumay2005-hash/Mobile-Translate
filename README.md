# Mobile Translation for Obsidian

Tap or Select the desired word to get it's translation from Google Translate. Works for Desktop too.

## Installation and Setup:

1. Install and enable the plugin from Obsidian Community Plugins.
2. If you wish to generate context sentence:
   go to https://aistudio.google.com/api-keys and create a gemini API key.

## Mobile Translate: Feature Guide

Source Language: Choose the original language of the text you want to translate, or use "Detect Language" to let the plugin figure it out automatically.

Target Language: Select your preferred destination language from the list of supported languages.

Hide Punctuation & Diacritics: Automatically strips punctuation marks, vowel points, and accent marks from the translation for a clean, distraction-free output.

Show Alternative Translations: Pulls additional dictionary meanings from Google to give you a broader understanding of the word.

Maximum Alternatives: A handy slider that lets you limit how many extra alternative translations are displayed (from 1 to 10).

Generate Context Sentence (Gemini AI): Leverages artificial intelligence to invent a short example sentence using your selected word in its native language. You can set this to run automatically during translation, trigger it manually via the command palette, or turn it off entirely.

Gemini API Key: Enter your Google AI Studio key to power the context sentences. The plugin automatically detects and utilizes the fastest, most up-to-date Flash-Lite model available on your account, complete with a built-in "Test API" button to verify your connection.

Insert Translation into Editor: Decide whether your translations, alternatives, and AI-generated sentences get directly pasted into your Obsidian note, or simply appear as a temporary notification popup on your screen.

Separator: Customize the characters used to separate your original word from its translation inline (such as -).
