import type { Translations } from './types'

export const enSharedMetrics: Translations['sharedMetrics'] = {
  consentTitle: 'Share usage stats?',
  dialogTitle: 'Usage stats',
  consentBody:
    'Aino can count how you use it: session length, which models and tools run, and when something fails. It never records your messages, files, paths or error text.',
  whatIsCollected: 'What is counted',
  collectedActivity: 'Sessions: length, outcome, error type, active time per day',
  collectedModels: 'Models: which ones, token totals',
  collectedNames: 'Features: built-in tools, commands, app areas and settings used or turned off',
  collectedMilestones: 'Setup: which steps finished, provider connections, how many skills, plugins and jobs',
  collectedReliability: 'App health: crashes, startup and reply speed, updates, messaging connections',
  collectedUsage: 'Agent quality: missed edits, broken tool calls, stuck loops, cost per task',
  collectedMachine: 'Machine: OS, RAM range, GPU type, Aino version, local model use',
  sending:
    'If you share, Aino sends aggregate counts once a day to api.agentera.com.cn with a random ID for this profile, without your account token. Aino administrators can read them. Access expires after 14 days and online copies are removed within one hour; backups follow the deployment retention policy. Apart from a one-time install note, data from before your new consent is never sent. Turn sharing off anytime in Settings.',
  readDocs: 'Read the full details',
  share: 'Share with Aino',
  off: 'No thanks',
  saveFailed: 'Couldn’t save your choice',
  sendLabel: 'Share usage stats with Aino',
  sendDesc:
    'Counts only, sent once a day with a random ID for this profile. Never your messages, files, paths or error text.',
  unavailable: 'Update the Aino backend to change this setting.',
  stripBody: 'Counts only. Never your messages or files.',
  stripReaskBody:
    'The statistics recipient has changed to Aino. Your previous choice does not authorize this recipient; please choose again.',
  stripChoices: { share: 'Share with Aino', off: 'No thanks' },
  stripDetails: 'Details'
}
