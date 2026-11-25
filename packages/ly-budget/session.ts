import { createHmac } from 'node:crypto'
import Iron from '@hapi/iron'
import { serialize } from 'cookie'
import type { SessionStrategy } from '@keystone-6/core/types'
import {
  readCmsOrigin,
  readSessionMaxAge,
  validateSessionSecret,
} from './security-config'
import {
  appendAuthCookie,
  authCookieName,
  readUniqueCookie,
} from './auth-cookies'

// Build/postinstall also import configuration without runtime secrets.
// Validate before HTTP startup and before every use of the session strategy.
export function createCmsSession() {
  let settings: ReturnType<typeof buildSettings> | undefined
  const buildSettings = () => {
    const secret = validateSessionSecret(process.env.CMS_SESSION_SECRET)
    const origin = readCmsOrigin()
    const secure = origin.protocol === 'https:'
    return {
      origin,
      maxAge: readSessionMaxAge(),
      secret: createHmac('sha256', secret)
        .update(`ly-budget-google-session-v2\n${origin.origin}`)
        .digest('hex'),
      name: authCookieName(secure, 'session'),
      cookieOptions: {
        secure,
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
      },
    }
  }
  const initialize = () => {
    if (!settings) settings = buildSettings()
    return settings
  }
  const session: SessionStrategy<Record<string, unknown>> = {
    get: async ({ context }) => {
      // CMS accepts its HttpOnly cookie, never a client-supplied Bearer identity.
      const { req } = context
      if (!req || req.headers.authorization !== undefined) return
      const config = initialize()
      if (req.headers.host !== config.origin.host) return
      // SameSite alone trusts sibling subdomains. Authenticated writes require
      // the exact configured Origin, never Host/X-Forwarded-Host supplied by a client.
      if (
        req.headers.origin !== undefined &&
        req.headers.origin !== config.origin.origin
      )
        return
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') &&
        (req.headers.origin !== config.origin.origin ||
          (req.headers['sec-fetch-site'] !== undefined &&
            req.headers['sec-fetch-site'] !== 'same-origin'))
      )
        return
      const token = readUniqueCookie(req.headers.cookie, config.name)
      if (!token) return
      let identity: Record<string, unknown>
      try {
        identity = await Iron.unseal(token, config.secret, {
          ...Iron.defaults,
          timestampSkewSec: 0,
        })
      } catch {
        return
      }
      if (
        identity?.auth !== 'google-v1' ||
        identity.audience !== config.origin.origin ||
        identity.listKey !== 'User' ||
        !(
          (typeof identity.itemId === 'string' &&
            /^[1-9]\d*$/.test(identity.itemId)) ||
          (typeof identity.itemId === 'number' &&
            Number.isSafeInteger(identity.itemId) &&
            identity.itemId > 0)
        ) ||
        typeof identity.googleSubject !== 'string' ||
        !identity.googleSubject ||
        typeof identity.email !== 'string'
      )
        return
      // Reload permissions on every request. Old password sessions, disabled or
      // deleted users, and changed email/Google bindings are invalid immediately.
      const user = await context.sudo().db.User.findOne({
        where: { id: String(identity.itemId) },
      })
      if (
        !user ||
        user.isActive !== true ||
        user.googleSubject !== identity.googleSubject ||
        typeof user.email !== 'string' ||
        user.email.trim().toLowerCase() !== identity.email ||
        typeof user.role !== 'string' ||
        !['admin', 'moderator', 'editor', 'contributor'].includes(user.role)
      )
        return
      return {
        auth: 'google-v1',
        listKey: 'User',
        itemId: String(user.id),
        data: {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
        },
      }
    },
    start: async ({ context, data }) => {
      if (!context.res)
        throw new Error('Cannot issue a session without a response')
      const config = initialize()
      // Only the server's verified Google identity is sealed. Never serialize
      // client-provided roles, session data, or an incoming session token.
      const token = await Iron.seal(
        {
          auth: 'google-v1',
          listKey: 'User',
          itemId: data.itemId,
          email: data.email,
          googleSubject: data.googleSubject,
          audience: config.origin.origin,
        },
        config.secret,
        { ...Iron.defaults, ttl: config.maxAge * 1000 }
      )
      appendAuthCookie(
        context.res,
        serialize(config.name, token, {
          ...config.cookieOptions,
          maxAge: config.maxAge,
          expires: new Date(Date.now() + config.maxAge * 1000),
        })
      )
      return token
    },
    end: async ({ context }) => {
      if (!context.res) return
      const config = initialize()
      if (
        context.req &&
        (context.req.headers.host !== config.origin.host ||
          context.req.headers.origin !== config.origin.origin ||
          (context.req.headers['sec-fetch-site'] !== undefined &&
            context.req.headers['sec-fetch-site'] !== 'same-origin'))
      )
        return
      appendAuthCookie(
        context.res,
        serialize(config.name, '', {
          ...config.cookieOptions,
          maxAge: 0,
          expires: new Date(0),
        })
      )
    },
  }
  return { session, initialize }
}
