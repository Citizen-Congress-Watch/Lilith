export function readAccessControlStrategy(
  value = process.env.ACCESS_CONTROL_STRATEGY
) {
  const strategy = value || 'cms'
  if (strategy !== 'cms' && strategy !== 'gql' && strategy !== 'preview') {
    throw new Error('ACCESS_CONTROL_STRATEGY must be cms, gql or preview')
  }
  return strategy
}

export const accessControlStrategy = readAccessControlStrategy()
export const isReadOnly = accessControlStrategy !== 'cms'

export function validateSessionSecret(secret: string | undefined): string {
  if (
    !secret ||
    secret.trim() !== secret ||
    secret.length < 32 ||
    new Set(secret).size < 8 ||
    /default|example|change.?me|session.?secret/i.test(secret)
  ) {
    throw new Error(
      'Set CMS_SESSION_SECRET to a new cryptographically random secret (at least 32 characters). Legacy SESSION_SECRET is not accepted.'
    )
  }
  return secret
}

export function readSessionMaxAge(value = process.env.SESSION_MAX_AGE): number {
  if (value === undefined) return 60 * 60 * 24
  const maxAge = Number(value)
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new Error('SESSION_MAX_AGE must be a positive integer in seconds')
  }
  return maxAge
}

export function readCmsOrigin(env = process.env): URL {
  if (!env.CMS_ORIGIN)
    throw new Error('Set CMS_ORIGIN to the canonical CMS origin')
  const origin = new URL(env.CMS_ORIGIN)
  const production = env.NODE_ENV === 'production' || env.NODE_ENV === 'prod'
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(origin.protocol === 'http:' && local && !production))
  )
    throw new Error(
      'CMS_ORIGIN must be an HTTPS origin (HTTP localhost is allowed in development)'
    )
  return origin
}
