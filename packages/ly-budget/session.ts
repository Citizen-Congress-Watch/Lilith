import { statelessSessions } from '@keystone-6/core/session'
import type { SessionStrategy } from '@keystone-6/core/types'
import { readSessionMaxAge, validateSessionSecret } from './security-config'

// Build/postinstall also import configuration without runtime secrets.
// Validate before HTTP startup and before every use of the session strategy.
export function createCmsSession() {
  let strategy: SessionStrategy<Record<string, unknown>> | undefined
  const initialize = () => {
    if (!strategy) {
      strategy = statelessSessions({
        secret: validateSessionSecret(process.env.CMS_SESSION_SECRET),
        maxAge: readSessionMaxAge(),
        secure:
          process.env.NODE_ENV === 'production' ||
          process.env.NODE_ENV === 'prod',
        sameSite: 'lax',
      })
    }
    return strategy
  }
  const session: SessionStrategy<Record<string, unknown>> = {
    get: (args) => initialize().get(args),
    start: (args) => initialize().start(args),
    end: (args) => initialize().end(args),
  }
  return { session, initialize }
}
