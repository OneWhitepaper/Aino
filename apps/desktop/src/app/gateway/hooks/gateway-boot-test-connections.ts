export const primaryConn = {
  authMode: 'token' as 'oauth' | 'token',
  baseUrl: 'https://vps.example.com',
  connectionId: 'primary-vps',
  profile: 'default',
  token: 't',
  wsUrl: 'wss://vps.example.com/api/ws?token=t'
}

export const remotePrimaryConn = { ...primaryConn, mode: 'remote' as const }

export const coderConn = {
  authMode: 'token' as const,
  baseUrl: 'https://coder.example.com',
  connectionId: 'coder-remote',
  profile: 'coder',
  token: 'c',
  wsUrl: 'wss://coder.example.com/api/ws?token=c'
}
