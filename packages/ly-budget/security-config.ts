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
