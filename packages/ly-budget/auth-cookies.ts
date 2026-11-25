import type { ServerResponse } from 'node:http'

export function authCookieName(secure: boolean, purpose: 'session' | 'oauth') {
  return secure ? `__Host-ly-budget-${purpose}` : `ly-budget-${purpose}-local`
}

// Cookie parsers commonly pick the first duplicate. Reject ambiguous identities
// rather than letting cookie order decide which account is authenticated.
export function readUniqueCookie(header: string | undefined, name: string) {
  if (typeof header !== 'string') return
  const matches = header.split(';').filter((part) => {
    const index = part.indexOf('=')
    return index >= 0 && part.slice(0, index).trim() === name
  })
  if (matches.length !== 1) return
  const raw = matches[0].slice(matches[0].indexOf('=') + 1).trim()
  if (!raw || raw.length > 4096) return
  try {
    return decodeURIComponent(raw)
  } catch {
    return
  }
}

export function appendAuthCookie(res: ServerResponse, cookie: string) {
  const previous = res.getHeader('Set-Cookie')
  res.setHeader('Set-Cookie', [
    ...(Array.isArray(previous)
      ? previous.map(String)
      : previous
      ? [String(previous)]
      : []),
    cookie,
  ])
}
