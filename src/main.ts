import { Plugin, Editor, MarkdownView, Notice, requestUrl } from 'obsidian';
import {
	TranslatorPluginSettings,
	DEFAULT_SETTINGS,
	TranslatorSettingTab,
} from './settings';

interface GeminiModel {
	name: string;
	supportedGenerationMethods?: string[];
}

interface GeminiModelsResponse {
	models?: GeminiModel[];
}

interface GeminiCandidate {
	content: {
		parts: { text: string }[];
	};
}

interface GeminiGenerateResponse {
	candidates?: GeminiCandidate[];
}

interface TranslateSentence {
	trans?: string;
}

interface TranslateDict {
	terms?: string[];
}

interface TranslateDefinitionEntry {
	gloss?: string;
}

interface TranslateDefinition {
	pos?: string;
	entry?: TranslateDefinitionEntry[];
}

interface TranslateResponse {
	sentences?: TranslateSentence[];
	dict?: TranslateDict[];
	definitions?: TranslateDefinition[];
}

interface GoogleTranslationBody {
	q: string[];
	target: string;
	format: string;
	source?: string;
}

interface GoogleTranslationResponse {
	data?: {
		translations?: { translatedText: string }[];
	};
}

export default class MyTranslatorPlugin extends Plugin {
	settings!: TranslatorPluginSettings;
	cachedGeminiModel: string | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TranslatorSettingTab(this.app, this));

		// 1. Translate Button & Command
		this.addRibbonIcon('languages', 'Translate Text', () => {
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) void this.processTranslation(activeView.editor);
			else new Notice('Please open a file first.');
		});

		this.addCommand({
			id: 'translate-selected-text',
			name: 'Translate text',
			icon: 'languages',
			callback: () => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) void this.processTranslation(activeView.editor);
				else new Notice('Please open a file first.');
			},
		});

		// 2. Context Sentence Button & Command
		this.addRibbonIcon('sparkles', 'Generate AI Context', () => {
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView)
				void this.processContextGeneration(activeView.editor);
			else new Notice('Please open a file first.');
		});

		this.addCommand({
			id: 'generate-context-sentence',
			name: 'Generate context sentence',
			icon: 'sparkles',
			callback: () => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView)
					void this.processContextGeneration(activeView.editor);
				else new Notice('Please open a file first.');
			},
		});

		// 3. NEW: AI Explanation Only Button & Command
		this.addRibbonIcon('book', 'Generate AI Explanation', () => {
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView)
				void this.processExplanationGeneration(activeView.editor);
			else new Notice('Please open a file first.');
		});

		this.addCommand({
			id: 'generate-ai-explanation',
			name: 'Generate AI explanation',
			icon: 'book',
			callback: () => {
				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView)
					void this.processExplanationGeneration(activeView.editor);
				else new Notice('Please open a file first.');
			},
		});
	}

	onunload() {
		// Cleanup resources here if needed
	}

	async loadSettings() {
		const loadedData =
			(await this.loadData()) as Partial<TranslatorPluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		if (!this.settings.outputBlocks) {
			this.settings.outputBlocks = DEFAULT_SETTINGS.outputBlocks;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private cleanApiKey(key: string): string {
		return key.replace(/[\u200B-\u200D\uFEFF\s"']/g, '').trim();
	}

	private removePunctuation(text: string): string {
		return text
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[\p{P}\u0591-\u05C7]/gu, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
	}

	private sanitizeContextSentence(sentence: string): string {
		return sentence.replace(/^["'״׳]+|["'״׳]+$/g, '').trim();
	}

	private formatSourceWord(word: string): string {
		// Checks if the word starts with a lowercase English letter
		if (this.settings.capitalizeFirstLetter && /^[a-z]/.test(word)) {
			return word.charAt(0).toUpperCase() + word.slice(1);
		}
		return word;
	}

	async getResolvedModel(): Promise<string> {
		if (this.cachedGeminiModel) return this.cachedGeminiModel;

		const apiKey = this.cleanApiKey(this.settings.geminiApiKey);
		if (!apiKey) return 'gemini-1.5-flash-lite';

		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
			const response = await requestUrl({ url: url, method: 'GET' });

			if (response.status === 200 && response.json) {
				const json = response.json as GeminiModelsResponse;
				if (json.models) {
					const validModels = json.models
						.filter((m) =>
							m.supportedGenerationMethods?.includes(
								'generateContent',
							),
						)
						.map((m) => m.name.replace('models/', ''));

					const liteModel = validModels.find((name) =>
						name.includes('flash-lite'),
					);

					if (liteModel) {
						this.cachedGeminiModel = liteModel;
						return liteModel;
					}
				}
			}
		} catch (error: unknown) {
			console.error(
				'[Mobile Translate] Failed to auto-detect model:',
				error,
			);
		}

		return 'gemini-1.5-flash-lite';
	}

	async processTranslation(editor: Editor) {
		let selection = editor.getSelection().trim();
		if (!selection) {
			new Notice('No text selected.');
			return;
		}

		if (
			this.settings.useOutputBuilder &&
			(!this.settings.outputBlocks ||
				this.settings.outputBlocks.length === 0)
		) {
			new Notice(
				'Please add at least one block in the Output Builder settings.',
			);
			return;
		}

		const rawSelection = selection;
		const displaySelection = this.formatSourceWord(rawSelection);

		if (this.settings.hidePunctuation) {
			selection = this.removePunctuation(selection);
		}

		new Notice('Translating...');

		try {
			let translatedText = '';
			let alternatives: string[] = [];
			let googleDictText = '';

			const wantsAlternatives =
				this.settings.useOutputBuilder &&
				this.settings.outputBlocks.some(
					(b) => b.type === 'alternatives',
				);
			const wantsGoogleDict =
				this.settings.useOutputBuilder &&
				this.settings.outputBlocks.some(
					(b) => b.type === 'google-dict',
				);

			if (this.settings.useOfficialApi) {
				const apiKey = this.cleanApiKey(this.settings.googleApiKey);
				if (!apiKey) {
					new Notice('Official Google API key missing.');
					return;
				}
				const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

				const bodyPayload: GoogleTranslationBody = {
					q: [selection],
					target: this.settings.targetLanguage,
					format: 'text',
				};

				if (this.settings.sourceLanguage !== 'auto') {
					bodyPayload.source = this.settings.sourceLanguage;
				}

				const response = await requestUrl({
					url: url,
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(bodyPayload),
				});

				const json = response.json as GoogleTranslationResponse;

				if (response.status === 200 && json.data?.translations?.[0]) {
					translatedText = json.data.translations[0].translatedText;
				} else {
					throw new Error('API returned an invalid structure.');
				}
			} else {
				const sl = this.settings.sourceLanguage;
				const tl = this.settings.targetLanguage;
				const query = encodeURIComponent(selection);

				const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&dt=bd&dt=md&dj=1&q=${query}`;

				const response = await requestUrl({ url: url, method: 'GET' });
				if (response.status === 200 && response.json) {
					const data = response.json as TranslateResponse;
					if (data.sentences && data.sentences.length > 0) {
						translatedText = data.sentences
							.map((s) => s.trans || '')
							.join(' ');
					}

					if (
						wantsAlternatives &&
						data.dict &&
						data.dict.length > 0
					) {
						const allTerms = data.dict.flatMap(
							(d) => d.terms || [],
						);
						alternatives = [...new Set(allTerms)];
						alternatives = alternatives.filter(
							(term) =>
								term.toLowerCase() !==
								translatedText.toLowerCase(),
						);
					}

					if (
						wantsGoogleDict &&
						data.definitions &&
						data.definitions.length > 0
					) {
						const defs = data.definitions.flatMap((d) =>
							(d.entry || []).map((e) => e.gloss).filter(Boolean),
						);
						if (defs.length > 0) {
							googleDictText = defs.slice(0, 2).join('; '); // Keep it relatively short
						}
					}
				} else {
					throw new Error('Unofficial API connection failed.');
				}
			}

			if (this.settings.hidePunctuation) {
				translatedText = this.removePunctuation(translatedText);
				alternatives = alternatives
					.map((alt) => this.removePunctuation(alt))
					.filter(
						(alt) =>
							alt.trim() !== '' &&
							alt.toLowerCase() !== translatedText.toLowerCase(),
					);
				alternatives = [...new Set(alternatives)];
			}

			if (!this.settings.useOutputBuilder) {
				editor.replaceSelection(
					`${displaySelection}${this.settings.inlineSeparator}${translatedText}`,
				);
				new Notice('Translation successfully completed.');
				return;
			}

			let contextText = '';
			if (this.settings.outputBlocks.some((b) => b.type === 'context')) {
				const contextSentence =
					await this.fetchGeminiContext(rawSelection);
				if (contextSentence) {
					contextText = this.sanitizeContextSentence(contextSentence);
				}
			}

			let geminiExplanationText = '';
			if (
				this.settings.outputBlocks.some(
					(b) => b.type === 'gemini-explanation',
				)
			) {
				const explanation =
					await this.fetchGeminiExplanation(rawSelection);
				if (explanation) {
					// Stripping punctuation from the Gemini Explanation per request
					geminiExplanationText = this.removePunctuation(explanation);
				}
			}

			const finalOutputLines: string[] = [];

			for (const block of this.settings.outputBlocks) {
				if (block.type === 'translation') {
					finalOutputLines.push(translatedText);
				} else if (block.type === 'alternatives') {
					if (alternatives.length > 0) {
						const limit = this.settings.alternativesCount;
						const slicedAlts = alternatives.slice(0, limit);
						finalOutputLines.push(
							`Alternatives: ${slicedAlts.join(', ')}`,
						);
					}
				} else if (block.type === 'context') {
					if (contextText) {
						finalOutputLines.push(`"${contextText}"`);
					}
				} else if (block.type === 'gemini-explanation') {
					if (geminiExplanationText) {
						finalOutputLines.push(geminiExplanationText);
					}
				} else if (block.type === 'google-dict') {
					if (googleDictText) {
						finalOutputLines.push(`Dictionary: ${googleDictText}`);
					}
				} else if (block.type === 'custom') {
					if (block.text && block.text.trim().length > 0) {
						finalOutputLines.push(block.text);
					}
				}
			}

			const finalBlocksText = finalOutputLines
				.filter((line) => line.trim() !== '')
				.join('\n');

			if (finalBlocksText) {
				editor.replaceSelection(
					`${displaySelection}\n${finalBlocksText}`,
				);
			} else {
				editor.replaceSelection(displaySelection);
			}

			new Notice('Translation successfully completed.');
		} catch (error: unknown) {
			console.error('Translation Plugin Error:', error);
			const errorMsg =
				error instanceof Error
					? error.message
					: 'Check API key or network.';
			new Notice(`Translation error: ${errorMsg}`);
		}
	}

	async processContextGeneration(editor: Editor) {
		const selection = editor.getSelection().trim();
		if (!selection) {
			new Notice('Select a word for context generation.');
			return;
		}

		new Notice('Requesting context sentence from AI...');
		const contextSentence = await this.fetchGeminiContext(selection);

		if (contextSentence) {
			const cleanSentence = this.sanitizeContextSentence(contextSentence);
			const displaySelection = this.formatSourceWord(selection);
			editor.replaceSelection(`${displaySelection}\n"${cleanSentence}"`);
			new Notice('Context generated successfully.');
		}
	}

	async processExplanationGeneration(editor: Editor) {
		const selection = editor.getSelection().trim();
		if (!selection) {
			new Notice('Select a word for explanation.');
			return;
		}

		new Notice('Requesting explanation from AI...');
		let explanation = await this.fetchGeminiExplanation(selection);

		if (explanation) {
			explanation = this.removePunctuation(explanation);
			const displaySelection = this.formatSourceWord(selection);
			editor.replaceSelection(`${displaySelection}\n${explanation}`);
			new Notice('Explanation generated successfully.');
		}
	}

	async fetchGeminiContext(phrase: string): Promise<string | null> {
		const apiKey = this.cleanApiKey(this.settings.geminiApiKey);
		if (!apiKey) {
			new Notice('Gemini API key is missing. Skipping context.');
			return null;
		}

		try {
			const model = await this.getResolvedModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
			const prompt = `Write exactly one short and natural context sentence demonstrating the use of the word/phrase: "${phrase}". The sentence MUST be written entirely in the same language as the word "${phrase}". Do not mix languages. Return ONLY the sentence, no quotation marks, no introductory text.`;

			const response = await requestUrl({
				url: url,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.1,
						maxOutputTokens: 50,
					},
				}),
			});

			if (response.status === 200 && response.json) {
				const json = response.json as GeminiGenerateResponse;
				const text = json.candidates?.[0]?.content?.parts?.[0]?.text;

				if (text) {
					return text.trim();
				}
			}
			return null;
		} catch (error: unknown) {
			console.error('Gemini API Error:', error);
			new Notice('Gemini API Error: Check key or restrictions.');
			return null;
		}
	}

	async fetchGeminiExplanation(phrase: string): Promise<string | null> {
		const apiKey = this.cleanApiKey(this.settings.geminiApiKey);
		if (!apiKey) {
			new Notice('Gemini API key is missing.');
			return null;
		}

		try {
			const model = await this.getResolvedModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

			// Ultra-sharp, concise prompt
			const prompt = `Provide an ultra-concise, sharp dictionary definition for the term: "${phrase}". Maximum 10 to 15 words. Keep it direct, precise, and strictly informational. No introductory words, no conversational fluff. The explanation MUST be written entirely in the language corresponding to the ISO code "${this.settings.targetLanguage}". Return ONLY the definition text.`;

			const response = await requestUrl({
				url: url,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.1,
						maxOutputTokens: 60,
					},
				}),
			});

			if (response.status === 200 && response.json) {
				const json = response.json as GeminiGenerateResponse;
				const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
				if (text) return text.trim();
			}
			return null;
		} catch (error: unknown) {
			console.error('Gemini Explanation Error:', error);
			new Notice('Gemini API Error.');
			return null;
		}
	}
}
