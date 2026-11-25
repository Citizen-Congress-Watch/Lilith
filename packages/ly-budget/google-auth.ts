import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import Iron from '@hapi/iron'
import { OAuth2Client, TokenPayload } from 'google-auth-library'
import { graphql } from '@keystone-6/core'
import type { KeystoneContext, SessionStrategy } from '@keystone-6/core/types'
import type { Express, Request, Response } from 'express'
import { readCmsOrigin, validateSessionSecret } from './security-config'
import { authCookieName, readUniqueCookie } from './auth-cookies'

const CALLBACK_PATH = '/auth/google/callback'
const STATE_TTL = 10 * 60 * 1000
const ROLES = ['admin', 'moderator', 'editor', 'contributor']

export function readGoogleOAuthConfig(env = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (
    !clientId ||
    !clientId.endsWith('.apps.googleusercontent.com') ||
    !clientSecret
  ) {
    throw new Error(
      'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET for CMS Google login'
    )
  }
  const origin = readCmsOrigin(env)
  return {
    clientId,
    clientSecret,
    origin: origin.origin,
    redirectUri: origin.origin + CALLBACK_PATH,
    secure: origin.protocol === 'https:',
    stateSecret: createHmac(
      'sha256',
      validateSessionSecret(env.CMS_SESSION_SECRET)
    )
      .update(`ly-budget-google-oauth-state-v2\n${origin.origin}\n${clientId}`)
      .digest('hex'),
  }
}

type OAuthConfig = ReturnType<typeof readGoogleOAuthConfig>
type GoogleClaims = TokenPayload & { nonce?: string }
type Transaction = { state: string; nonce: string; verifier: string }

function equal(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.length > 0 &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  )
}

export async function exchangeGoogleCode(
  code: string,
  verifier: string,
  config: OAuthConfig
): Promise<GoogleClaims> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let tokens: { id_token?: string }
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }),
    })
    if (!response.ok) throw new Error('Google code exchange failed')
    tokens = (await response.json()) as { id_token?: string }
  } finally {
    clearTimeout(timeout)
  }
  if (typeof tokens.id_token !== 'string')
    throw new Error('Missing Google ID token')
  // Google's client verifies the signature, issuer, audience and expiry.
  const ticket = await googleVerifier.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.clientId,
  })
  const claims = ticket.getPayload()
  if (!claims) throw new Error('Invalid Google ID token')
  return claims
}
// Reuse Google's signing-certificate cache across requests.
const googleVerifier = new OAuth2Client()

export function validateGoogleClaims(
  claims: GoogleClaims,
  nonce: string,
  clientId: string
) {
  if (
    !equal(claims.nonce, nonce) ||
    claims.email_verified !== true ||
    typeof claims.email !== 'string' ||
    !claims.email.includes('@') ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 255 ||
    (claims.azp !== undefined && claims.azp !== clientId)
  )
    throw new Error('Invalid Google identity')
  return { sub: claims.sub, email: claims.email.trim().toLowerCase() }
}

export async function findGoogleUser(
  context: KeystoneContext,
  claims: GoogleClaims
) {
  const sub = claims.sub
  const email = claims.email!.trim().toLowerCase()
  const users = context.prisma.user
  let user = await users.findUnique({ where: { googleSubject: sub } })
  if (!user) {
    const matches = await users.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      take: 2,
    })
    if (matches.length !== 1) throw new Error('User not allowed')
    user = matches[0]
  }
  if (
    !user.isActive ||
    user.email.trim().toLowerCase() !== email ||
    !ROLES.includes(user.role) ||
    (user.googleSubject && user.googleSubject !== sub)
  )
    throw new Error('User not allowed')

  if (!user.googleSubject) {
    // For third-party, non-Workspace email addresses, email_verified alone does
    // not prove current ownership. An admin must pre-bind those accounts by sub.
    if (
      !email.endsWith('@gmail.com') &&
      !(typeof claims.hd === 'string' && claims.hd)
    ) {
      throw new Error('Google identity requires administrator binding')
    }
    // Compare-and-set prevents simultaneous first logins overwriting a binding.
    await users.updateMany({
      where: {
        id: user.id,
        email: user.email,
        isActive: true,
        googleSubject: null,
      },
      data: { googleSubject: sub },
    })
  }
  // Recheck after binding, including concurrent admin changes.
  const current = await users.findUnique({ where: { id: user.id } })
  if (
    !current?.isActive ||
    current.googleSubject !== sub ||
    current.email.trim().toLowerCase() !== email ||
    !ROLES.includes(current.role)
  ) {
    throw new Error('User not allowed')
  }
  return { itemId: String(current.id), email, googleSubject: sub }
}

export function registerGoogleOAuth(
  app: Express,
  context: KeystoneContext,
  session: SessionStrategy<Record<string, unknown>>,
  exchange = exchangeGoogleCode
) {
  // Called at HTTP startup, not during build/postinstall.
  const config = readGoogleOAuthConfig()
  const stateCookie = authCookieName(config.secure, 'oauth')
  const cookieOptions = {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'lax' as const,
    path: '/',
  }
  const protect = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (req.headers.host !== new URL(config.origin).host) {
      // Never derive an OAuth redirect URI from Host or X-Forwarded-* headers.
      res.redirect(303, config.origin + '/signin')
      return false
    }
    return true
  }
  app.get('/auth/google', async (req, res) => {
    if (!protect(req, res)) return
    try {
      const transaction: Transaction = {
        state: randomBytes(32).toString('base64url'),
        nonce: randomBytes(32).toString('base64url'),
        verifier: randomBytes(32).toString('base64url'),
      }
      const sealed = await Iron.seal(transaction, config.stateSecret, {
        ...Iron.defaults,
        ttl: STATE_TTL,
      })
      res.cookie(stateCookie, sealed, { ...cookieOptions, maxAge: STATE_TTL })
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: transaction.state,
        nonce: transaction.nonce,
        prompt: 'select_account',
        code_challenge: createHash('sha256')
          .update(transaction.verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString()
      res.redirect(302, url.toString())
    } catch {
      res.redirect(303, '/signin?error=google')
    }
  })
  app.get(CALLBACK_PATH, async (req, res) => {
    if (!protect(req, res)) return
    // Consume the browser transaction even on denial or failed validation.
    res.clearCookie(stateCookie, cookieOptions)
    try {
      const sealed = readUniqueCookie(req.headers.cookie, stateCookie)
      if (
        !sealed ||
        typeof req.query.state !== 'string' ||
        typeof req.query.code !== 'string' ||
        !req.query.code ||
        req.query.error
      ) {
        throw new Error('Missing OAuth transaction')
      }
      const transaction = (await Iron.unseal(sealed, config.stateSecret, {
        ...Iron.defaults,
        timestampSkewSec: 0,
      })) as Transaction
      if (
        !equal(transaction.state, req.query.state) ||
        typeof transaction.verifier !== 'string' ||
        !transaction.verifier
      ) {
        throw new Error('Invalid OAuth transaction')
      }
      const claims = await exchange(
        req.query.code,
        transaction.verifier,
        config
      )
      validateGoogleClaims(claims, transaction.nonce, config.clientId)
      const identity = await findGoogleUser(context, claims)
      const requestContext = await context.withRequest(req, res)
      await session.start({
        context: requestContext,
        data: { auth: 'google-v1', listKey: 'User', ...identity },
      })
      res.redirect(303, '/')
    } catch {
      // Never log OAuth codes/tokens or leak account existence to the browser.
      res.redirect(303, '/signin?error=google')
    }
  })
}

// Preserve Keystone's signed-in user display; endSession is provided by core.
// No password, password reset, magic-link or bootstrap mutations are installed.
export const googleAuthSchema = graphql.extend((base) => ({
  query: {
    authenticatedItem: graphql.field({
      type: graphql.union({
        name: 'AuthenticatedItem',
        types: [base.object('User')],
        resolveType: () => 'User',
      }),
      resolve: (_root, _args, context) => {
        if (!context.session?.data?.id) return null
        return context
          .sudo()
          .db.User.findOne({ where: { id: context.session.data.id } })
      },
    }),
  },
}))
