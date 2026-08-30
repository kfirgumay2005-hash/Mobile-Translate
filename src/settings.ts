import { App, PluginSettingTab, Setting } from 'obsidian';
import MobileTranslatePlugin from './main';

export const LANGUAGES: Record<string, string> = {
	auto: 'Detect Language',
	af: 'Afrikaans',
	sq: 'Albanian',
	ar: 'Arabic',
	'zh-CN': 'Chinese (Simplified)',
	'zh-TW': 'Chinese (Traditional)',
	en: 'English',
	fr: 'French',
	de: 'German',
	he: 'Hebrew',
	it: 'Italian',
	ja: 'Japanese',
	ko: 'Korean',
	pt: 'Portuguese',
	ru: 'Russian',
	es: 'Spanish',
};

export interface MobileTranslateSettings {
	sourceLang: string;
	targetLang: string;
	insertIntoEditor: boolean;
	separator: string;
	removePunctuation: boolean;
	showAlternatives: boolean;
	maxAlternatives: number;
	sentenceMode: 'off' | 'auto' | 'manual';
	geminiApiKey: string;
}

export const DEFAULT_SETTINGS: MobileTranslateSettings = {
	sourceLang: 'auto',
	targetLang: 'en',
	insertIntoEditor: true,
	separator: ' - ',
	removePunctuation: false,
	showAlternatives: false,
	maxAlternatives: 4,
	sentenceMode: 'off',
	geminiApiKey: '',
};

export class MobileTranslateSettingTab extends PluginSettingTab {
	plugin: MobileTranslatePlugin;

	constructor(app: App, plugin: MobileTranslatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Prevents warning about getSettingDefinitions missing in Obsidian 1.13+
	public getSettingDefinitions() {
		return [];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API Configuration (Required)')
			.setHeading();

		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc(
				'Mandatory for translations and generating sentences. The plugin automatically detects and uses the latest, fastest Flash-Lite model.',
			)
			.addText((text) =>
				text
					.setPlaceholder('AQ.Ab8...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText('Test API & Model')
					.setCta()
					.onClick(async () => {
						btn.setButtonText('Testing...');
						const success = await this.plugin.testGeminiAPI();
						btn.setButtonText(success ? 'Success!' : 'Failed');
						window.setTimeout(
							() => btn.setButtonText('Test API & Model'),
							3000,
						);
					}),
			);

		containerEl.createEl('hr');
		new Setting(containerEl)
			.setName('Translation Preferences')
			.setHeading();

		new Setting(containerEl)
			.setName('Source Language')
			.setDesc('Select the original language')
			.addDropdown((drop) => {
				for (const [code, name] of Object.entries(LANGUAGES)) {
					drop.addOption(code, name);
				}
				drop.setValue(this.plugin.settings.sourceLang).onChange(
					async (value) => {
						this.plugin.settings.sourceLang = value;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(containerEl)
			.setName('Target Language')
			.setDesc('Select the language to translate to')
			.addDropdown((drop) => {
				for (const [code, name] of Object.entries(LANGUAGES)) {
					if (code !== 'auto') drop.addOption(code, name);
				}
				drop.setValue(this.plugin.settings.targetLang).onChange(
					async (value) => {
						this.plugin.settings.targetLang = value;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(containerEl)
			.setName('Hide Punctuation & Diacritics')
			.setDesc(
				'Remove punctuation marks and specific language diacritics from the translation',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.removePunctuation)
					.onChange(async (value) => {
						this.plugin.settings.removePunctuation = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Show Alternative Translations')
			.setDesc(
				'Display alternative dictionary translations below the main translation',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAlternatives)
					.onChange(async (value) => {
						this.plugin.settings.showAlternatives = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.showAlternatives) {
			new Setting(containerEl)
				.setName('Maximum Alternatives')
				.setDesc(
					'Set the maximum number of alternative translations to retrieve',
				)
				.addSlider((slider) =>
					slider
						.setLimits(1, 10, 1)
						.setValue(this.plugin.settings.maxAlternatives)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.maxAlternatives = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName('Generate Context Sentence')
			.setDesc(
				'Generate an example sentence in the language of the selected word.',
			)
			.addDropdown((drop) =>
				drop
					.addOption('auto', 'Automatic (During Translation)')
					.addOption('manual', 'Manual (Via Command Only)')
					.setValue(this.plugin.settings.sentenceMode)
					.onChange(async (value: string) => {
						this.plugin.settings.sentenceMode = value as
							| 'off'
							| 'auto'
							| 'manual';
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('hr');
		new Setting(containerEl).setName('Insert Translation').setHeading();

		new Setting(containerEl)
			.setName('Insert the translation near the selected text')
			.setDesc(
				'If disabled, the translation will only appear as a popup Notice.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.insertIntoEditor)
					.onChange(async (value) => {
						this.plugin.settings.insertIntoEditor = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.insertIntoEditor) {
			new Setting(containerEl)
				.setName('Separator')
				.setDesc(
					'The string used to separate the word and its translation inline',
				)
				.addText((text) =>
					text
						.setPlaceholder(' - ')
						.setValue(this.plugin.settings.separator)
						.onChange(async (value) => {
							this.plugin.settings.separator = value;
							await this.plugin.saveSettings();
						}),
				);
		}
	}
}
