import { App, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';
import type MyTranslatorPlugin from './main';

export const LANGUAGES: Record<string, string> = {
	auto: 'Automatic Detection',
	en: 'English',
	he: 'Hebrew',
	es: 'Spanish',
	fr: 'French',
	de: 'German',
	ru: 'Russian',
	ar: 'Arabic',
	'zh-CN': 'Chinese (Simplified)',
	ja: 'Japanese',
	it: 'Italian',
	pt: 'Portuguese',
	nl: 'Dutch',
	ko: 'Korean',
	tr: 'Turkish',
	pl: 'Polish',
	hi: 'Hindi',
	sv: 'Swedish',
	fi: 'Finnish',
	el: 'Greek',
};

export type BlockType = 'translation' | 'context' | 'alternatives' | 'custom';

export interface TemplateBlock {
	id: string;
	type: BlockType;
	text?: string;
}

export interface TranslatorPluginSettings {
	useOfficialApi: boolean;
	googleApiKey: string;
	sourceLanguage: string;
	targetLanguage: string;
	hidePunctuation: boolean;
	alternativesCount: number;
	geminiApiKey: string;
	useOutputBuilder: boolean;
	inlineSeparator: string;
	outputBlocks: TemplateBlock[];
}

export const DEFAULT_SETTINGS: TranslatorPluginSettings = {
	useOfficialApi: false,
	googleApiKey: '',
	sourceLanguage: 'auto',
	targetLanguage: 'he',
	hidePunctuation: false,
	alternativesCount: 3,
	geminiApiKey: '',
	useOutputBuilder: false,
	inlineSeparator: ' - ',
	outputBlocks: [
		{ id: '1', type: 'translation' },
		{ id: '2', type: 'alternatives' },
	],
};

export class TranslatorSettingTab extends PluginSettingTab {
	plugin: MyTranslatorPlugin;

	constructor(app: App, plugin: MyTranslatorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private cleanApiKey(key: string): string {
		return key.replace(/[\u200B-\u200D\uFEFF\s"']/g, '').trim();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Google Translate Configuration' });

		new Setting(containerEl)
			.setName('Use Cloud Translation API')
			.setDesc('Enable if it is not working without an API')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useOfficialApi)
					.onChange(async (value) => {
						this.plugin.settings.useOfficialApi = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.useOfficialApi) {
			new Setting(containerEl)
				.setName('Google Cloud API Key')
				.setDesc('Enter your Cloud Translation API Key here')
				.addText((text) =>
					text
						.setPlaceholder('AIzaSy...')
						.setValue(this.plugin.settings.googleApiKey)
						.onChange(async (value) => {
							this.plugin.settings.googleApiKey = value;
							await this.plugin.saveSettings();
						}),
				)
				.addButton((button) =>
					button.setButtonText('Test Cloud API').onClick(async () => {
						const apiKey = this.cleanApiKey(
							this.plugin.settings.googleApiKey,
						);
						if (!apiKey) {
							new Notice('Please enter a Google Cloud API Key.');
							return;
						}
						try {
							const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
							const res = await requestUrl({
								url: url,
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									q: ['hello'],
									target: 'es',
									format: 'text',
								}),
							});
							if (res.status === 200) {
								new Notice(
									'Google Cloud API Connected Successfully!',
								);
							} else {
								new Notice(`Error: HTTP ${res.status}`);
							}
						} catch (e: any) {
							new Notice(
								'Cloud API Error: Check key and network.',
							);
						}
					}),
				);
		}

		new Setting(containerEl)
			.setName('Source Language')
			.addDropdown((dropdown) => {
				for (const [code, name] of Object.entries(LANGUAGES)) {
					dropdown.addOption(code, name);
				}
				dropdown
					.setValue(this.plugin.settings.sourceLanguage)
					.onChange(async (value) => {
						this.plugin.settings.sourceLanguage = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Target Language')
			.addDropdown((dropdown) => {
				for (const [code, name] of Object.entries(LANGUAGES)) {
					if (code !== 'auto') {
						dropdown.addOption(code, name);
					}
				}
				dropdown
					.setValue(this.plugin.settings.targetLanguage)
					.onChange(async (value) => {
						this.plugin.settings.targetLanguage = value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl('h2', { text: 'Formatting & UI Output' });

		new Setting(containerEl)
			.setName('Hide Punctuation')
			.setDesc('Strips punctuation from the output and alternatives.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hidePunctuation)
					.onChange(async (value) => {
						this.plugin.settings.hidePunctuation = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('h2', { text: 'Gemini AI Context Settings' });

		new Setting(containerEl)
			.setName('Gemini AI Studio API Key')
			.setDesc(
				'API key from Google AI Studio. Required for Context blocks and Context command.',
			)
			.addText((text) =>
				text
					.setPlaceholder('AQ...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((button) =>
				button.setButtonText('Test Gemini API').onClick(async () => {
					const apiKey = this.cleanApiKey(
						this.plugin.settings.geminiApiKey,
					);
					if (!apiKey) {
						new Notice('Please enter a Gemini API Key.');
						return;
					}
					try {
						this.plugin.cachedGeminiModel = null;
						const model = await this.plugin.getResolvedModel();
						const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
						const res = await requestUrl({
							url: url,
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								contents: [
									{
										parts: [
											{ text: "Respond with 'SUCCESS'" },
										],
									},
								],
							}),
						});
						if (res.status === 200) {
							new Notice(
								`Connected to Gemini API Successfully! (Model: ${model})`,
							);
						} else {
							new Notice(`Error: HTTP ${res.status}`);
						}
					} catch (e: any) {
						new Notice('Failed to connect to Gemini.');
					}
				}),
			);

		containerEl.createEl('h2', { text: 'Output Strategy' });

		new Setting(containerEl)
			.setName('Use Output Builder')
			.setDesc(
				'Enable to construct multi-line output using building blocks. If disabled, standard inline translation will be used.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useOutputBuilder)
					.onChange(async (value) => {
						this.plugin.settings.useOutputBuilder = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (!this.plugin.settings.useOutputBuilder) {
			new Setting(containerEl)
				.setName('Inline Separator')
				.setDesc(
					'Text to place between the original word and the translation (e.g. " - ")',
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.inlineSeparator)
						.onChange(async (value) => {
							this.plugin.settings.inlineSeparator = value;
							await this.plugin.saveSettings();
						}),
				);
		} else {
			new Setting(containerEl)
				.setName('Alternatives Limit')
				.setDesc(
					'Maximum number of alternatives to display in the alternatives block (1-10).',
				)
				.addSlider((slider) =>
					slider
						.setLimits(1, 10, 1)
						.setValue(this.plugin.settings.alternativesCount)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.alternativesCount = value;
							await this.plugin.saveSettings();
						}),
				);

			this.renderOutputBlockBuilder(containerEl);
		}
	}

	private renderOutputBlockBuilder(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Output Builder' });

		const desc = containerEl.createEl('p', {
			text: 'Build your output format! Add blocks and order them using the Up/Down arrows.',
		});
		desc.style.color = 'var(--text-muted)';
		desc.style.fontSize = '0.9em';
		desc.style.marginBottom = '15px';

		const blocksContainer = containerEl.createDiv();
		blocksContainer.style.display = 'flex';
		blocksContainer.style.flexDirection = 'column';
		blocksContainer.style.gap = '10px';
		blocksContainer.style.marginBottom = '20px';

		this.plugin.settings.outputBlocks.forEach((block, index) => {
			const blockEl = blocksContainer.createDiv();
			blockEl.style.display = 'flex';
			blockEl.style.alignItems = 'center';
			blockEl.style.gap = '12px';
			blockEl.style.padding = '12px';
			blockEl.style.backgroundColor = 'var(--background-secondary)';
			blockEl.style.border =
				'1px solid var(--background-modifier-border)';
			blockEl.style.borderRadius = '8px';

			const orderControls = blockEl.createDiv();
			orderControls.style.display = 'flex';
			orderControls.style.flexDirection = 'column';
			orderControls.style.gap = '4px';

			const upBtn = orderControls.createEl('button', { text: '▲' });
			upBtn.style.padding = '2px 6px';
			upBtn.style.boxShadow = 'none';
			upBtn.disabled = index === 0;
			if (!upBtn.disabled) upBtn.style.cursor = 'pointer';
			upBtn.onclick = async () => {
				const blocks = this.plugin.settings.outputBlocks;
				const current = blocks[index];
				const previous = blocks[index - 1];

				if (current && previous) {
					blocks[index - 1] = current;
					blocks[index] = previous;
					await this.plugin.saveSettings();
					this.display();
				}
			};

			const downBtn = orderControls.createEl('button', { text: '▼' });
			downBtn.style.padding = '2px 6px';
			downBtn.style.boxShadow = 'none';
			downBtn.disabled =
				index === this.plugin.settings.outputBlocks.length - 1;
			if (!downBtn.disabled) downBtn.style.cursor = 'pointer';
			downBtn.onclick = async () => {
				const blocks = this.plugin.settings.outputBlocks;
				const current = blocks[index];
				const next = blocks[index + 1];

				if (current && next) {
					blocks[index + 1] = current;
					blocks[index] = next;
					await this.plugin.saveSettings();
					this.display();
				}
			};

			const contentEl = blockEl.createDiv();
			contentEl.style.flexGrow = '1';

			const typeLabels: Record<string, string> = {
				translation: '🔤 Translation Block',
				context: '🧠 Context Sentence Block',
				alternatives: '🔄 Alternatives Block',
				custom: '✏️ Custom Text / Line',
			};

			contentEl.createEl('strong', { text: typeLabels[block.type] });

			if (block.type === 'custom') {
				const input = contentEl.createEl('input');
				input.type = 'text';
				input.value = block.text || '';
				input.placeholder = 'Type custom text... (e.g. ---)';
				input.style.width = '100%';
				input.style.marginTop = '8px';
				input.onchange = async () => {
					block.text = input.value;
					await this.plugin.saveSettings();
				};
			}

			const delBtn = blockEl.createEl('button', { text: '🗑️' });
			delBtn.style.boxShadow = 'none';
			delBtn.style.background = 'transparent';
			delBtn.style.cursor = 'pointer';
			delBtn.onclick = async () => {
				this.plugin.settings.outputBlocks.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			};
		});

		const addContainer = containerEl.createDiv();
		addContainer.style.display = 'flex';
		addContainer.style.gap = '10px';

		const selectEl = addContainer.createEl('select');
		selectEl.createEl('option', {
			value: 'translation',
			text: 'Translation Block',
		});
		selectEl.createEl('option', {
			value: 'context',
			text: 'Context Sentence Block',
		});
		selectEl.createEl('option', {
			value: 'alternatives',
			text: 'Alternatives Block',
		});
		selectEl.createEl('option', {
			value: 'custom',
			text: 'Custom Line Block',
		});

		const addBtn = addContainer.createEl('button', {
			text: '➕ Add Block',
			cls: 'mod-cta',
		});
		addBtn.onclick = async () => {
			this.plugin.settings.outputBlocks.push({
				id: Date.now().toString(),
				type: selectEl.value as BlockType,
				text: selectEl.value === 'custom' ? '' : undefined,
			});
			await this.plugin.saveSettings();
			this.display();
		};
	}
}
