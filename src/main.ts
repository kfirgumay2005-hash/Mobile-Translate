import { Plugin, Editor, Notice, requestUrl } from 'obsidian';
import {
	MobileTranslateSettings,
	DEFAULT_SETTINGS,
	MobileTranslateSettingTab,
} from './settings';

interface TranslationResult {
	main: string;
	alternatives: string | null;
}

export default class MobileTranslatePlugin extends Plugin {
	settings!: MobileTranslateSettings;
	cachedAutoModel: string | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MobileTranslateSettingTab(this.app, this));

		this.addCommand({
			id: 'translate-selected-word',
			name: 'Translate word',
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection().trim();

				if (!selection) {
					new Notice('No text selected for translation.');
					return;
				}

				new Notice('Translating...');

				try {
					let translation = await this.fetchTranslation(selection);

					if (translation) {
						if (this.settings.removePunctuation) {
							translation.main = this.cleanText(translation.main);
							if (translation.alternatives) {
								translation.alternatives = this.cleanText(
									translation.alternatives,
								);
							}
						}

						const shouldGenerate =
							this.settings.sentenceMode === 'auto' &&
							this.settings.geminiApiKey;
						const uniquePlaceholder = `⏳ Generating sentence for "${selection}"...`;

						if (this.settings.insertIntoEditor) {
							this.replaceSelection(
								editor,
								selection,
								translation,
								shouldGenerate ? uniquePlaceholder : null,
							);
						} else {
							let popupText = `Translation: ${translation.main}`;
							if (translation.alternatives)
								popupText += `\n${translation.alternatives}`;
							new Notice(popupText, 5000);
						}

						if (shouldGenerate) {
							this.fetchGeminiSentence(selection).then(
								(sentence) => {
									if (sentence) {
										if (this.settings.insertIntoEditor) {
											this.replaceTextInEditor(
												editor,
												uniquePlaceholder,
												sentence,
											);
										} else {
											new Notice(
												`Context for "${selection}":\n${sentence}`,
												7000,
											);
										}
									} else {
										if (this.settings.insertIntoEditor) {
											this.replaceTextInEditor(
												editor,
												uniquePlaceholder,
												'❌ Failed to generate sentence.',
											);
										}
									}
								},
							);
						}
					} else {
						new Notice('No translation found.');
					}
				} catch (error) {
					console.error('Translation error:', error);
					new Notice('Error connecting to services.');
				}
			},
		});

		this.addCommand({
			id: 'generate-context-sentence',
			name: 'Generate Context Sentence',
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection().trim();

				if (!selection) {
					new Notice('No text selected.');
					return;
				}
				if (!this.settings.geminiApiKey) {
					new Notice('Gemini API key is required.');
					return;
				}

				const uniquePlaceholder = `⏳ Generating sentence for "${selection}"...`;
				editor.replaceSelection(`${selection}\n> ${uniquePlaceholder}`);

				this.fetchGeminiSentence(selection).then((sentence) => {
					if (sentence) {
						this.replaceTextInEditor(
							editor,
							uniquePlaceholder,
							sentence,
						);
					} else {
						this.replaceTextInEditor(
							editor,
							uniquePlaceholder,
							'❌ Failed to generate.',
						);
					}
				});
			},
		});
	}

	cleanText(text: string): string {
		// Removes punctuation marks and combines diacritics globally
		return text
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[\p{P}\u0591-\u05C7]/gu, '')
			.trim();
	}

	replaceTextInEditor(
		editor: Editor,
		targetText: string,
		replacementText: string,
	) {
		const cursor = editor.getCursor();
		const lineCount = editor.lineCount();

		for (let i = 0; i < lineCount; i++) {
			const line = editor.getLine(i);
			if (line.includes(targetText)) {
				editor.setLine(i, line.replace(targetText, replacementText));
				break;
			}
		}
		editor.setCursor(cursor);
	}

	async fetchTranslation(text: string): Promise<TranslationResult | null> {
		const { sourceLang, targetLang, showAlternatives, maxAlternatives } =
			this.settings;
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&dt=bd&q=${encodeURIComponent(text)}`;
		const response = await requestUrl({ url: url, method: 'GET' });

		if (response.json && response.json[0]) {
			let mainTranslation = response.json[0]
				.map((s: any) => s[0])
				.join('');
			let alternativesText: string | null = null;

			if (showAlternatives && response.json[1]) {
				const alternatives: string[] = [];
				for (const pos of response.json[1]) {
					if (pos[1] && Array.isArray(pos[1]))
						alternatives.push(...pos[1].slice(0, maxAlternatives));
				}
				const uniqueAlts = [...new Set(alternatives)].filter(
					(alt) =>
						alt.toLowerCase() !== mainTranslation.toLowerCase(),
				);
				if (uniqueAlts.length > 0)
					alternativesText = uniqueAlts
						.slice(0, maxAlternatives)
						.join('\n');
			}
			return { main: mainTranslation, alternatives: alternativesText };
		}
		return null;
	}

	async getResolvedModel(): Promise<string> {
		if (this.cachedAutoModel) return this.cachedAutoModel;

		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.settings.geminiApiKey}`;
			const response = await requestUrl({ url: url, method: 'GET' });

			if (response.json && response.json.models) {
				const availableModels = response.json.models
					.map((m: any) => m.name.replace('models/', ''))
					.filter((name: string) => name.includes('flash-lite'));

				if (availableModels.length > 0) {
					availableModels.sort((a: string, b: string) =>
						b.localeCompare(a),
					);
					this.cachedAutoModel = availableModels[0];
					new Notice(`Auto-detected model: ${this.cachedAutoModel}`);
					return availableModels[0];
				}
			}
		} catch (error) {
			console.error('Failed to auto-detect model:', error);
		}
		return 'gemini-2.5-flash-lite';
	}

	async fetchGeminiSentence(word: string): Promise<string | null> {
		const apiKey = this.settings.geminiApiKey;
		const model = await this.getResolvedModel();
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

		try {
			const response = await requestUrl({
				url,
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{
									text: `Write a single, short example sentence using the exact word or phrase: "${word}". The sentence must be in the same natural language as the provided word. Do not include any other text, explanations, translations, or quotes. Return only the sentence itself.`,
								},
							],
						},
					],
				}),
			});

			if (response.json?.candidates?.[0]?.content?.parts?.[0]?.text) {
				return response.json.candidates[0].content.parts[0].text.trim();
			}
		} catch (error) {
			console.error('Gemini error:', error);
		}
		return null;
	}

	async testGeminiAPI(): Promise<boolean> {
		if (!this.settings.geminiApiKey) {
			new Notice('Please enter a Gemini API Key first.');
			return false;
		}
		try {
			const model = await this.getResolvedModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;
			const response = await requestUrl({
				url,
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({
					contents: [{ parts: [{ text: "Respond with 'OK'" }] }],
				}),
			});
			if (response.status === 200) {
				new Notice(
					`Gemini API is connected successfully! (Using: ${model})`,
				);
				return true;
			}
		} catch (error) {
			new Notice('API Test Failed.');
		}
		return false;
	}

	replaceSelection(
		editor: Editor,
		originalText: string,
		translation: TranslationResult,
		exampleSentence: string | null,
	) {
		let newText = `${originalText}${this.settings.separator}${translation.main}`;

		if (translation.alternatives) {
			newText += `\n${translation.alternatives}`;
		}
		if (exampleSentence) {
			newText += `\n> ${exampleSentence}`;
		}

		editor.replaceSelection(newText);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
