import type { Translations } from './types'

export const enMessaging = {
  directory: {
    statusFilters: 'Filter by connection state',
    title: 'Messaging',
    subtitle: 'Find Aino in the chat apps you already use.',
    common: 'Everyday platforms',
    commonHint: 'Teamwork and daily conversations',
    more: 'More chat platforms',
    moreHint: 'Connect your existing tools',
    integrations: 'Development & integrations',
    integrationsHint: 'APIs, events and agent connections',
    all: 'All platforms',
    configured: 'Configured',
    attention: 'Needs attention',
    configure: 'Configure',
    sendOnly: 'Send only',
    privacy: 'Each platform keeps its own credentials and access settings.',
    noMatches: 'No matching platforms',
    noMatchesHint: 'Try a different search or choose another filter.',
    showAll: 'Show all platforms',
    discardTitle: 'Discard unsaved changes?',
    discardHint: 'Your edited credentials have not been saved. Close without saving?',
    discard: 'Discard changes'
  },
  search: 'Search messaging...',
  statusFilter: {
    all: 'All',
    bad: 'Errors',
    good: 'Connected',
    muted: 'Inactive',
    warn: 'Needs attention'
  },
  loading: 'Loading messaging platforms...',
  loadFailed: 'Messaging platforms failed to load',
  states: {
    connected: 'Connected',
    connecting: 'Connecting',
    disabled: 'Disabled',
    fatal: 'Error',
    gateway_stopped: 'Messaging gateway stopped',
    not_configured: 'Needs setup',
    pending_restart: 'Restart needed',
    retrying: 'Retrying',
    startup_failed: 'Startup failed'
  },
  unknown: 'Unknown',
  hintPendingRestart: 'Restart the gateway from the status bar to apply this change.',
  sharedListenerUrl: 'Served on the shared gateway listener at',
  hintGatewayStopped: 'Start the gateway from the status bar to connect.',
  credentialsSet: 'Credentials set',
  needsSetup: 'Needs setup',
  gatewayStopped: 'Messaging gateway stopped',
  getCredentials: 'Get your credentials',
  openSetupGuide: 'Open setup guide',
  required: 'Required',
  recommended: 'Recommended',
  advanced: count => `Advanced (${count})`,
  noTokenNeeded: 'This platform does not need a token here. Use the setup guide above, then enable it below.',
  enabled: 'Enabled',
  disabled: 'Disabled',
  unsavedChanges: 'Unsaved changes',
  saving: 'Saving...',
  saveChanges: 'Save changes',
  saved: 'Saved',
  replaceValue: 'Replace current value',
  openDocs: 'Open docs',
  clearField: key => `Clear ${key}`,
  addListEntry: 'Add another',
  removeListEntry: 'Remove',
  listEntryPlaceholder: 'Enter an ID',
  enableAria: name => `Enable ${name}`,
  disableAria: name => `Disable ${name}`,
  platformEnabled: name => `${name} enabled`,
  platformDisabled: name => `${name} disabled`,
  restartToApply: 'This change takes effect after a gateway restart.',
  setupSaved: name => `${name} setup saved`,
  restartToReconnect: 'New credentials take effect after a gateway restart.',
  appliedLive: 'Applied to the running gateway.',
  connectingLive: 'The running gateway is connecting with the new credentials.',
  keyCleared: key => `${key} cleared`,
  setupUpdated: name => `${name} setup was updated.`,
  failedUpdate: name => `Failed to update ${name}`,
  failedSave: name => `Failed to save ${name}`,
  failedClear: key => `Failed to clear ${key}`,
  pendingRequests: count => `Pending requests (${count})`,
  pendingAria: count => `${count} pending pairing ${count === 1 ? 'request' : 'requests'}`,
  approvedUsers: count => `Approved users (${count})`,
  approve: 'Approve',
  approving: 'Approving...',
  revoke: 'Revoke',
  revoking: 'Revoking...',
  revokeAria: name => `Revoke ${name}`,
  revokeTitle: 'Revoke access',
  revokeDesc: (name: string) => `${name} will lose access and stop being recognized on their next message.`,
  approvedUser: name => `${name} approved`,
  approvedHint: 'They are recognized automatically on their next message.',
  revokedUser: name => `${name} revoked`,
  failedApprove: name => `Failed to approve ${name}`,
  failedRevoke: name => `Failed to revoke ${name}`,
  pairingLockedOut: 'Too many failed approvals — this platform is locked out. Try again later.',
  waitingSince: minutes => (minutes < 1 ? 'just now' : `${minutes}m ago`),
  restartNeeded: 'Saved. Restart the messaging gateway so the new settings take effect.',
  restartNow: 'Restart now',
  restarting: 'Restarting…',
  restartFailedManual: "Hermes couldn't restart to apply your messaging settings",
  restartFailedManualDetail: 'Try Restart again; if it still fails, open the logs and send diagnostics.',
  restartAgain: 'Restart again',
  openLogs: 'Open logs',
  telegramQr: {
    title: 'Choose how to connect your Telegram bot',
    subtitle: 'Both options connect a bot you control and save its credentials only to this Hermes installation.',
    quickSetup: 'Quick setup',
    recommended: 'Recommended',
    quickHelp:
      'Scan a QR code and confirm in Telegram. Hermes creates the bot and detects your Telegram user ID automatically.',
    createWithQr: 'Create with QR',
    starting: 'Starting…',
    replaceWarning:
      'Telegram credentials are already configured. A new QR setup or bot token will replace the current bot when you save.',
    scanHint: 'Scan with the Telegram app on your phone, or open the link on this computer.',
    waiting: 'Waiting for Telegram…',
    expiresIn: remaining => `Expires in ${remaining}`,
    expired: 'Expired',
    openTelegram: 'Open Telegram',
    ready: 'Bot created',
    allowedUsers: 'Allowed users',
    ownerDetected: 'Owner detected',
    addAtLeastOne: 'Add at least one Telegram user ID.',
    userIdPlaceholder: 'Telegram user ID',
    add: 'Add',
    numericOnly: 'Allowed Telegram user IDs must be numeric.',
    saveAndRestart: 'Save and restart',
    applying: 'Saving…',
    pairingExpired: 'Telegram pairing expired. Start a new QR setup to try again.',
    stillWaiting: detail => `Still waiting for Telegram. Retrying after: ${detail}`,
    savedRestarting: 'Telegram saved; gateway restarting…',
    savedRestartFailed: detail => `Telegram saved; gateway restart failed${detail}`
  },
  fieldCopy: {
    TELEGRAM_BOT_TOKEN: {
      label: 'Bot token',
      help: 'Create a bot with @BotFather, then paste the token it gives you.',
      placeholder: 'Paste Telegram bot token'
    },
    TELEGRAM_ALLOWED_USERS: {
      label: 'Allowed Telegram user IDs',
      help: 'Recommended. Numeric IDs from @userinfobot, one per box. Without this, anyone can DM your bot.'
    },
    TELEGRAM_PROXY: { label: 'Proxy URL', help: 'Only needed on networks where Telegram is blocked.' },
    DISCORD_BOT_TOKEN: {
      label: 'Bot token',
      help: 'Create an application in the Discord Developer Portal, add a bot, then paste its token.'
    },
    DISCORD_ALLOWED_USERS: {
      label: 'Allowed Discord user IDs',
      help: 'Recommended. Discord user IDs, one per box.'
    },
    DISCORD_REPLY_TO_MODE: { label: 'Reply style', help: 'first, all, or off.' },
    DISCORD_ALLOW_ALL_USERS: {
      label: 'Allow all Discord users',
      help: 'Development only. When true, anyone can DM the bot without an allowlist.'
    },
    DISCORD_HOME_CHANNEL: {
      label: 'Home channel ID',
      help: 'Channel where the bot sends proactive messages (cron output, reminders).'
    },
    DISCORD_HOME_CHANNEL_NAME: {
      label: 'Home channel name',
      help: 'Display name for the home channel in logs and status output.'
    },
    BLUEBUBBLES_ALLOW_ALL_USERS: {
      label: 'Allow all iMessage users',
      help: 'When true, skip the BlueBubbles allowlist.'
    },
    MATTERMOST_ALLOW_ALL_USERS: { label: 'Allow all Mattermost users' },
    MATTERMOST_HOME_CHANNEL: { label: 'Home channel' },
    QQ_ALLOW_ALL_USERS: { label: 'Allow all QQ users' },
    QQBOT_HOME_CHANNEL: { label: 'QQ home channel', help: 'Default channel or group for cron delivery.' },
    QQBOT_HOME_CHANNEL_NAME: { label: 'QQ home channel name' },
    SLACK_BOT_TOKEN: {
      label: 'Slack bot token',
      help: 'Use the bot token from OAuth & Permissions after installing your Slack app.',
      placeholder: 'Paste Slack bot token'
    },
    SLACK_APP_TOKEN: {
      label: 'Slack app token',
      help: 'Use the app-level token required for Socket Mode.',
      placeholder: 'Paste Slack app token'
    },
    SLACK_ALLOWED_USERS: { label: 'Allowed Slack user IDs', help: 'Recommended. Slack user IDs, one per box.' },
    MATTERMOST_URL: { label: 'Server URL', placeholder: 'https://mattermost.example.com' },
    MATTERMOST_TOKEN: { label: 'Bot token' },
    MATTERMOST_ALLOWED_USERS: {
      label: 'Allowed user IDs',
      help: 'Recommended. Mattermost user IDs, one per box.'
    },
    MATRIX_HOMESERVER: { label: 'Homeserver URL', placeholder: 'https://matrix.org' },
    MATRIX_ACCESS_TOKEN: { label: 'Access token' },
    MATRIX_USER_ID: { label: 'Bot user ID', placeholder: '@hermes:example.org' },
    MATRIX_ALLOWED_USERS: {
      label: 'Allowed Matrix user IDs',
      help: 'Recommended. User IDs in @user:server format, one per box.'
    },
    SIGNAL_HTTP_URL: {
      label: 'Signal bridge URL',
      placeholder: 'http://127.0.0.1:8080',
      help: 'URL of a running signal-cli REST bridge.'
    },
    SIGNAL_ACCOUNT: { label: 'Phone number', help: 'The number registered with your signal-cli bridge.' },
    SIGNAL_ALLOWED_USERS: { label: 'Allowed Signal users', help: 'Recommended. Signal identifiers, one per box.' },
    WHATSAPP_ENABLED: {
      label: 'Enable WhatsApp bridge',
      help: 'Set automatically by the toggle below. Leave alone unless you know you need it.'
    },
    WHATSAPP_MODE: { label: 'Bridge mode' },
    WHATSAPP_ALLOWED_USERS: {
      label: 'Allowed WhatsApp users',
      help: 'Recommended. Phone numbers or WhatsApp IDs, one per box.'
    }
  },
  platformIntro: {}
} satisfies Translations['messaging']
