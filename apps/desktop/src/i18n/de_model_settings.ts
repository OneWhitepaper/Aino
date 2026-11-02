import type { TranslationOverride } from '@hermes/shared/i18n'

import { deAuxTasks } from './de_aux_tasks'
import { deDelegationRouting } from './de_delegation_routing'
import type { ModelSettingsTranslations } from './types_model_settings'

export const deModelSettings: TranslationOverride<ModelSettingsTranslations> = {
  imageGeneration: {
    billingRules: 'Abrechnung gemäß den Regeln zur Bilderzeugung. Den Verbrauch finden Sie unter Mein Konto.',
    unavailable:
      'Die Aino-Bilderzeugung ist nicht verfügbar. Aktualisieren Sie die Laufzeit und prüfen Sie die Bildmodelle auf der Plattform.',
    title: 'Bilderzeugung',
    description:
      'Erzeugen Sie Bilder mit Ihrem Aino-Konto. Bildmodelle werden getrennt von Textmodellen verwaltet; die Auswahl gilt für neue Gespräche.'
  },
  pages: {
    description: 'Standardmodell und Modelle für verschiedene Aufgaben verwalten.',
    auxiliaryTask: 'Aufgabe',
    auxiliaryPurpose: 'Zweck',
    auxiliaryModel: 'Modell',
    moaReferences: 'Referenzmodelle',
    moaEnableDescription: 'Aktivierte Vorlagen bleiben über das bestehende Modellrouting verfügbar.'
  },
  defaultMain: {
    appliedLabel: 'Aktuelles Standardmodell',
    applied: 'Angewendet',
    unconfigured: 'Kein Standardmodell ausgewählt',
    title: 'Standard-Hauptmodell',
    description: 'Wählen Sie eine Standardmodellquelle für neue Sitzungen.',
    sourceLabel: 'Modellquelle',
    builtIn: 'Integrierte Aino-Modelle',
    thirdParty: 'Drittanbieterdienst',
    builtInDescription: 'Verwenden Sie Ihr Aino-Guthaben ohne separaten API-Schlüssel.',
    thirdPartyDescription: 'Verwenden Sie einen verbundenen Modelldienst mit Abrechnung durch dessen Anbieter.',
    unchanged: 'Entspricht dem aktuellen Standard',
    pending: 'Nicht angewendet · der aktuelle Standard bleibt unverändert',
    apply: 'Als Standard anwenden',
    scopeHint:
      'Gilt für neue Sitzungen. In bestehenden Chats können Sie das Modell im Eingabefeld wechseln. Manuelle Auswahlen werden weiterhin verwendet.',
    defaultsTitle: 'Standardparameter',
    defaultsDescription: 'Vorhandene Parameter gelten, wenn das Modell sie unterstützt.',
    reasoningDescription: 'Steuert die Analysetiefe vor der Antwort',
    speedDescription: 'Schnellere Antworten können eine andere Dienststufe verwenden',
    chooseBuiltIn: 'Integriertes Aino-Modell auswählen',
    selectionTitle: 'Integriertes Aino-Modell auswählen',
    selectionDescription: 'Bestätigen Sie Ihre Auswahl und klicken Sie auf der Seite auf „Als Standard anwenden“.',
    confirmSelection: 'Auswahl bestätigen',
    configureConnection: 'Verbindung konfigurieren',
    connection: 'API-Schlüssel',
    connectionSaved: 'Dienst eingerichtet · Modell auswählen',
    ainoConnected: 'Aino-Konto verbunden · verwendet Aino-Guthaben'
  },
  setupProviderFallback: 'Anbieter',
  setUpProvider: name => `${name} einrichten`,
  staleAuxBefore: (count, names) =>
    `${count} Hilfsaufgabe${count === 1 ? '' : 'n'} (${names}) ${count === 1 ? 'läuft' : 'laufen'} noch auf `,
  staleAuxAfter: ', nicht auf Ihrem Hauptmodell.',
  staleAuxOtherProviders: 'anderen Anbietern',
  moaEnabled: 'Aktiviert',
  moaSetDefault: 'Als Standard festlegen',
  moaNewPresetPlaceholder: 'neue Vorlage',
  moaAddPreset: 'Vorlage hinzufügen',
  customModel: 'Eigenes Modell…',
  customModelPlaceholder: 'Modell-ID',
  chooseFromList: 'Aus Liste wählen',
  moaDefault: 'Standard:',
  moaReferenceToggle: (enabled, index) => `Referenz ${index} ${enabled ? 'deaktivieren' : 'aktivieren'}`,
  moaReferenceTitle: index => `Referenz ${index}`,
  moaAddReference: 'Referenzmodell hinzufügen',
  loading: 'Modellkonfiguration wird geladen…',
  appliesDesc:
    'Gilt für neue Sessions. Verwenden Sie die Modellauswahl im Composer, um im aktiven Chat schnell zu wechseln.',
  provider: 'Anbieter',
  model: 'Modell',
  applying: 'Wird angewendet…',
  mainAppliedTitle: 'Hauptmodell aktualisiert',
  mainAppliedMessage: model => `Neue Sitzungen verwenden ${model}.`,
  defaultsLabel: 'Voreinstellungen',
  reasoning: 'Denken',
  reasoningOff: 'Aus',
  speed: 'Geschwindigkeit',
  speedStandard: 'Standard',
  defaultsFailed: 'Voreinstellungen des Modells konnten nicht gespeichert werden',
  loadFailed: 'Modelle konnten nicht geladen werden',
  restartRequired:
    'Dieses Backend führt nach einem Update alten Code aus. Starten Sie es neu, um den neuen Code zu laden.',
  restartBackend: 'Backend neu starten',
  restartingBackend: 'Backend wird neu gestartet…',
  restartFailed: 'Das Backend konnte nicht neu gestartet werden',
  auxiliaryTitle: 'Hilfsmodelle',
  resetAllToMain: 'Alle auf Hauptmodell zurücksetzen',
  staleAuxDismiss: 'Nicht erneut anzeigen',
  auxiliaryDesc:
    'Hilfsaufgaben laufen standardmäßig auf dem Hauptmodell. Weise einer Aufgabe ein eigenes Modell zu, um das zu überschreiben.',
  setToMain: 'Auf Hauptmodell setzen',
  change: 'Ändern',
  autoUseMain: 'automatisch · Hauptmodell verwenden',
  inheritMainEffort: 'übernehmen · Aufwand des Hauptmodells',
  inheritsFrom: task => `erbt von ${task}`,
  followTask: task => `${task} folgen`,
  providerDefault: '(Anbietervorgabe)',
  fallbackAdd: 'Fallback hinzufügen',
  fallbackEmpty: 'Keine Fallback-Modelle — es wird das Standardmodell verwendet, außer es schlägt fehl.',
  notInCatalog: 'ist nicht in der Modellliste dieses Anbieters enthalten — Aufrufe können auf ein Backup ausweichen.',
  moaTitle: 'Mixture of Agents',
  moaPreset: 'Voreinstellung',
  moaDescription:
    'Konfigurieren Sie benannte Vorlagen, die als Modelle unter dem Anbieter „Mixture of Agents“ erscheinen. Der Aggregator ist das handelnde Modell – er führt jeden Schritt der Tool-Schleife aus, und fast alle Kosten des Laufs werden seinem Anbieter berechnet. Referenzen beraten standardmäßig nur einmal pro Benutzer-Turn.',
  moaAggregator: 'Aggregator',
  moaAggregatorBilled: 'handelndes Modell · wird für den Lauf berechnet',
  moaReferenceHint: 'berät standardmäßig einmal pro Turn',
  tasks: deAuxTasks,
  subagents: {
    inherit: 'Vom Hauptagenten übernehmen',
    modelOnly: 'Eigenes Modell (Zugangsdaten des Hauptagenten)',
    providerLabel: 'Subagent-Anbieter',
    modelLabel: 'Subagent-Modell',
    direct: 'Direkter Endpunkt',
    customProvider: 'Eigener Anbieter...',
    customProviderLabel: 'Eigener Subagent-Anbieter',
    parentModel: 'Modell des Hauptagenten verwenden',
    parentModelWarning:
      'Der gewählte Anbieter muss das Modell des Hauptagenten unterstützen. Eine reine Anbieter-Route kann bei inkompatiblem Modell fehlschlagen. Legt dieser Anbieter ein eigenes Standardmodell fest, verwenden Subagents stattdessen dieses.',
    directActive:
      'Ein direkter Endpunkt ist aktiv und hat Vorrang vor dem gespeicherten Anbieter. Endpunkt und Zugangsdaten bleiben erhalten, solange dieser Modus gewählt ist.',
    directClear:
      'Diese Route entfernt den direkten Endpunkt und seinen gespeicherten Schlüssel. Andere Anfrage-Einstellungen bleiben erhalten.',
    catalogFailed: 'Modellkatalog nicht verfügbar. Anbieter und Modell manuell eingeben oder erneut versuchen.',
    draftHint: 'Änderungen bleiben lokal, bis sie übernommen werden.',
    routing: deDelegationRouting
  }
}
