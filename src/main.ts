import { Plugin, Editor, MarkdownView, Notice, requestUrl } from 'obsidian';
import {
	MobileTranslateSettings,
	DEFAULT_SETTINGS,
	MobileTranslateSettingTab,
	LANGUAGES,
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
			id: 'translate-selected-text',
			name: 'Translate text',
			icon: 'languages',
			callback: async () => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) {
					new Notice('Please open a file first.');
					return;
				}
				const editor = activeView.editor;
				const selection = editor.getSelection().trim();

				if (!selection) {
					new Notice('No text selected for translation.');
					return;
				}

				if (!this.getCleanApiKey()) {
					new Notice(
						'Gemini API key is required. Please set it in the plugin settings.',
					);
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
							this.settings.sentenceMode === 'auto';
						const uniquePlaceholder =
							'⏳ Generating sentence for "' + selection + '"...';

						if (this.settings.insertIntoEditor) {
							this.replaceSelection(
								editor,
								selection,
								translation,
								shouldGenerate ? uniquePlaceholder : null,
							);
						} else {
							let popupText = 'Translation: ' + translation.main;
							if (translation.alternatives)
								popupText += '\n' + translation.alternatives;
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
												'Context for "' +
													selection +
													'":\n' +
													sentence,
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
				} catch (error: any) {
					console.error(
						'[Mobile Translate] Detailed Translation error:',
						error,
					);
					new Notice('Error connecting: ' + (error.message || error));
				}
			},
		});

		this.addCommand({
			id: 'generate-context-sentence',
			name: 'Generate Context Sentence',
			icon: 'sparkles',
			callback: async () => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) {
					new Notice('Please open a file first.');
					return;
				}
				const editor = activeView.editor;
				const selection = editor.getSelection().trim();

				if (!selection) {
					new Notice('No text selected.');
					return;
				}
				if (!this.getCleanApiKey()) {
					new Notice('Gemini API key is required.');
					return;
				}

				const uniquePlaceholder =
					'⏳ Generating sentence for "' + selection + '"...';
				editor.replaceSelection(selection + '\n> ' + uniquePlaceholder);

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

	getCleanApiKey(): string {
		const rawKey = this.settings.geminiApiKey || '';
		return rawKey.trim();
	}

	cleanText(text: string): string {
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
		const apiKey = this.getCleanApiKey();
		if (!apiKey) return null;

		const model = await this.getResolvedModel();
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

		const targetLangName =
			LANGUAGES[this.settings.targetLang] || this.settings.targetLang;
		const maxAlt = this.settings.showAlternatives
			? this.settings.maxAlternatives
			: 0;

		const promptText =
			'Translate the exact word or phrase "' +
			text +
			'" to ' +
			targetLangName +
			'.\n' +
			'Return ONLY a raw JSON object (no markdown, no quotes) with this exact structure:\n' +
			'{"main": "primary translation", "alternatives": []}.\n' +
			'If alternatives exist, put up to ' +
			maxAlt +
			' distinct alternative translation strings in the array. If none or max is 0, leave empty.';

		try {
			const response = await requestUrl({
				url: url,
				method: 'POST',
				contentType: 'application/json',
				headers: { 'x-goog-api-key': apiKey },
				body: JSON.stringify({
					contents: [{ parts: [{ text: promptText }] }],
				}),
			});

			if (response.json?.candidates?.[0]?.content?.parts?.[0]?.text) {
				let rawText =
					response.json.candidates[0].content.parts[0].text.trim();
				rawText = rawText
					.replace(/^```json/i, '')
					.replace(/^```/i, '')
					.replace(/```$/i, '')
					.trim();

				const parsedData = JSON.parse(rawText);
				let alternativesText: string | null = null;

				if (
					this.settings.showAlternatives &&
					Array.isArray(parsedData.alternatives) &&
					parsedData.alternatives.length > 0
				) {
					alternativesText = parsedData.alternatives.join('\n');
				}

				return {
					main: parsedData.main || '',
					alternatives: alternativesText,
				};
			}
		} catch (err: any) {
			console.error('[Mobile Translate] Translation Error:', err);
			new Notice('Translation Failed: ' + (err.message || err.status));
		}

		return null;
	}

	async getResolvedModel(): Promise<string> {
		if (this.cachedAutoModel) return this.cachedAutoModel;

		const apiKey = this.getCleanApiKey();
		if (!apiKey) return 'gemini-2.0-flash';

		const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

		try {
			const response = await requestUrl({
				url: url,
				method: 'GET',
				headers: { 'x-goog-api-key': apiKey },
			});

			if (response.json && response.json.models) {
				const validModels = response.json.models
					.filter((m: any) =>
						m.supportedGenerationMethods?.includes(
							'generateContent',
						),
					)
					.map((m: any) => m.name.replace('models/', ''));

				const selectedModel =
					validModels.find((name: string) =>
						name.includes('flash-lite'),
					) ||
					validModels.find((name: string) =>
						name.includes('flash'),
					) ||
					validModels[0];

				if (selectedModel) {
					this.cachedAutoModel = selectedModel;
					console.log(
						'[Mobile Translate] Auto-detected model: ' +
							selectedModel,
					);
					return selectedModel;
				}
			}
		} catch (error: any) {
			console.error(
				'[Mobile Translate] Failed to auto-detect model:',
				error,
			);
		}

		console.log(
			'[Mobile Translate] Falling back to default model: gemini-2.0-flash',
		);
		return 'gemini-2.0-flash';
	}

	async fetchGeminiSentence(word: string): Promise<string | null> {
		const apiKey = this.getCleanApiKey();
		if (!apiKey) return null;

		const model = await this.getResolvedModel();
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
		try {
			const response = await requestUrl({
				url: url,
				method: 'POST',
				contentType: 'application/json',
				headers: { 'x-goog-api-key': apiKey },
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{
									text:
										'Write a single, short example sentence using the exact word or phrase: "' +
										word +
										'". The sentence must be in the same natural language as the provided word. Do not include any other text, explanations, translations, or quotes. Return only the sentence itself.',
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
			console.error('[Mobile Translate] Gemini Sentence Error:', error);
		}
		return null;
	}

	async testGeminiAPI(): Promise<boolean> {
		const apiKey = this.getCleanApiKey();
		if (!apiKey) {
			new Notice('Please enter a Gemini API Key first.');
			return false;
		}

		this.cachedAutoModel = null;

		try {
			const model = await this.getResolvedModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

			const response = await requestUrl({
				url: url,
				method: 'POST',
				contentType: 'application/json',
				headers: { 'x-goog-api-key': apiKey },
				body: JSON.stringify({
					contents: [{ parts: [{ text: "Respond with 'OK'" }] }],
				}),
			});

			if (response.status === 200) {
				new Notice(
					'API Connected Successfully! (Model: ' + model + ')',
				);
				return true;
			}
		} catch (error: any) {
			console.error(
				'[Mobile Translate] API Test Failed Detailed Error:',
				error,
			);

			const status = error.status ? ' [HTTP ' + error.status + ']' : '';
			const msg = error.message || 'Network error / invalid response';

			if (error.status === 400 || error.status === 403) {
				new Notice(
					'API Error' +
						status +
						': Invalid API Key or API not enabled in Google Cloud Studio.',
				);
			} else if (error.status === 404) {
				new Notice('API Error' + status + ': Model not found.');
			} else {
				new Notice('API Test Failed' + status + ': ' + msg);
			}
		}
		return false;
	}

	replaceSelection(
		editor: Editor,
		originalText: string,
		translation: TranslationResult,
		exampleSentence: string | null,
	) {
		let newText = originalText + this.settings.separator + translation.main;

		if (translation.alternatives) {
			newText += '\n' + translation.alternatives;
		}
		if (exampleSentence) {
			newText += '\n> ' + exampleSentence;
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
