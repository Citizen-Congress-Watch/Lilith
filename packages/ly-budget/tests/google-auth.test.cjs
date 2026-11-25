const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  randomBytes,
  generateKeyPairSync,
  sign,
  createHash,
} = require('node:crypto')
const fs = require('node:fs')
const ts = require('typescript')
const cookie = require('cookie')
const Iron = require('@hapi/iron')
const { OAuth2Client } = require('google-auth-library')

require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(source.outputText, filename)
}
process.env.ACCESS_CONTROL_STRATEGY = 'cms'
process.env.NODE_ENV = 'production'
process.env.CMS_SESSION_SECRET = randomBytes(48).toString('hex')
process.env.CMS_ORIGIN = 'https://cms.example.com'
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test.apps.googleusercontent.com'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
const {
  readGoogleOAuthConfig,
  registerGoogleOAuth,
  validateGoogleClaims,
  findGoogleUser,
  exchangeGoogleCode,
} = require('../google-auth.ts')
const { createCmsSession } = require('../session.ts')

const member = () => ({
  id: 1,
  name: 'Editor',
  email: 'member@example.com',
  role: 'editor',
  isActive: true,
  googleSubject: null,
})
const claimsFor = (nonce) => ({
  sub: 'google-member',
  email: 'member@example.com',
  email_verified: true,
  hd: 'example.com',
  nonce,
})
function database(initial = [member()]) {
  const rows = structuredClone(initial)
  let writes = 0
  const user = {
    findUnique: async ({ where }) =>
      rows.find((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value)
      ) || null,
    findMany: async ({ where }) =>
      rows.filter(
        (row) => row.email.toLowerCase() === where.email.equals.toLowerCase()
      ),
    updateMany: async ({ where, data }) => {
      let count = 0
      for (const row of rows)
        if (Object.entries(where).every(([key, value]) => row[key] === value)) {
          Object.assign(row, data)
          count++
          writes++
        }
      return { count }
    },
  }
  const context = {
    prisma: { user },
    sudo: () => ({
      db: {
        User: {
          findOne: async ({ where }) =>
            rows.find((row) => String(row.id) === where.id) || null,
        },
      },
    }),
    withRequest: async (req, res) => ({ ...context, req, res }),
  }
  return { context, rows, writes: () => writes }
}
function response() {
  const headers = {}
  return {
    headers,
    getHeader(name) {
      return headers[name.toLowerCase()]
    },
    setHeader(name, value) {
      headers[name.toLowerCase()] = value
    },
    cookie(name, value, options) {
      const current = headers['set-cookie'] || []
      headers['set-cookie'] = [
        ...(Array.isArray(current) ? current : [current]),
        cookie.serialize(name, value, {
          ...options,
          maxAge: options.maxAge / 1000,
        }),
      ]
    },
    clearCookie(name, options) {
      this.cookie(name, '', { ...options, maxAge: 0 })
    },
    redirect(status, location) {
      this.status = status
      this.location = location
    },
  }
}
function cookies(res) {
  const values = res.headers['set-cookie'] || []
  return Object.assign(
    {},
    ...(Array.isArray(values) ? values : [values]).map((x) =>
      cookie.parse(x.split(';')[0])
    )
  )
}
async function flow(initial, exchange) {
  const db = database(initial)
  const routes = {}
  let exchanges = 0
  const session = createCmsSession().session
  registerGoogleOAuth(
    {
      get: (path, handler) => {
        routes[path] = handler
      },
    },
    db.context,
    session,
    async (...args) => {
      exchanges++
      return exchange(...args)
    }
  )
  const start = response()
  await routes['/auth/google'](
    { headers: { host: 'cms.example.com' }, query: {} },
    start
  )
  const url = new URL(start.location)
  const stateCookie = cookies(start)['__Host-ly-budget-oauth']
  const request = {
    headers: {
      host: 'cms.example.com',
      cookie: '__Host-ly-budget-oauth=' + encodeURIComponent(stateCookie),
    },
    query: { code: 'one-use-code', state: url.searchParams.get('state') },
  }
  return {
    ...db,
    routes,
    session,
    start,
    url,
    request,
    exchanges: () => exchanges,
  }
}

test('runtime config requires explicit credentials and a trusted HTTPS origin', () => {
  for (const name of [
    'CMS_ORIGIN',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'CMS_SESSION_SECRET',
  ]) {
    assert.throws(() => readGoogleOAuthConfig({ ...process.env, [name]: '' }))
  }
  for (const origin of [
    'http://cms.example.com',
    'https://evil@cms.example.com',
    'https://cms.example.com/redirect',
    'https://cms.example.com?x=1',
    'http://localhost:3000',
  ]) {
    assert.throws(() =>
      readGoogleOAuthConfig({ ...process.env, CMS_ORIGIN: origin })
    )
  }
  assert.equal(
    readGoogleOAuthConfig({
      ...process.env,
      NODE_ENV: 'development',
      CMS_ORIGIN: 'http://localhost:3000',
    }).secure,
    false
  )
})

test('authorization code flow uses state, nonce and PKCE, binds User and issues a valid CMS cookie', async () => {
  let f
  f = await flow(undefined, async (code, verifier, config) => {
    assert.equal(code, 'one-use-code')
    assert.equal(
      config.redirectUri,
      'https://cms.example.com/auth/google/callback'
    )
    assert.equal(
      createHash('sha256').update(verifier).digest('base64url'),
      f.url.searchParams.get('code_challenge')
    )
    return claimsFor(f.url.searchParams.get('nonce'))
  })
  assert.equal(f.url.origin, 'https://accounts.google.com')
  assert.equal(f.url.searchParams.get('code_challenge_method'), 'S256')
  assert.match(f.start.headers['set-cookie'][0], /HttpOnly/)
  assert.match(f.start.headers['set-cookie'][0], /Secure/)
  assert.equal(f.start.headers['cache-control'], 'no-store')
  const result = response()
  await f.routes['/auth/google/callback'](f.request, result)
  assert.equal(result.location, '/')
  assert.equal(f.rows[0].googleSubject, 'google-member')
  assert.equal(f.writes(), 1)
  const resultCookies = cookies(result)
  assert.equal(resultCookies['__Host-ly-budget-oauth'], '')
  const context = {
    ...f.context,
    req: {
      headers: {
        host: 'cms.example.com',
        cookie:
          '__Host-ly-budget-session=' +
          resultCookies['__Host-ly-budget-session'],
      },
    },
  }
  const authenticated = await f.session.get({ context })
  assert.equal(authenticated.data.role, 'editor')
  f.rows[0].role = 'contributor'
  assert.equal((await f.session.get({ context })).data.role, 'contributor')
  f.rows[0].isActive = false
  assert.equal(await f.session.get({ context }), undefined)
  f.rows[0].isActive = true
  f.rows[0].email = 'replacement@example.com'
  assert.equal(await f.session.get({ context }), undefined)
  f.rows[0].email = 'member@example.com'
  f.rows[0].googleSubject = 'replacement-sub'
  assert.equal(await f.session.get({ context }), undefined)
  f.rows[0].googleSubject = 'google-member'
  assert.equal(
    await f.session.get({
      context: {
        ...context,
        req: {
          headers: {
            authorization:
              'Bearer ' + resultCookies['__Host-ly-budget-session'],
          },
        },
      },
    }),
    undefined
  )
  const ended = response()
  await f.session.end({ context: { res: ended } })
  assert.equal(cookies(ended)['__Host-ly-budget-session'], '')
})

test('missing, altered, expired or mismatched state and Google cancellation cannot reach token exchange', async () => {
  const f = await flow(undefined, async () => {
    throw new Error('must not run')
  })
  const config = readGoogleOAuthConfig()
  const expired = await Iron.seal(
    { state: f.request.query.state, verifier: 'verifier', nonce: 'nonce' },
    config.stateSecret,
    { ...Iron.defaults, ttl: -120000 }
  )
  const cases = [
    { headers: { host: 'cms.example.com' }, query: f.request.query },
    { ...f.request, query: { ...f.request.query, state: 'wrong' } },
    { ...f.request, query: { ...f.request.query, state: ['a', 'b'] } },
    { ...f.request, query: { ...f.request.query, error: 'access_denied' } },
    {
      ...f.request,
      headers: {
        host: 'cms.example.com',
        cookie: '__Host-ly-budget-oauth=forged',
      },
    },
    {
      ...f.request,
      headers: {
        host: 'cms.example.com',
        cookie: '__Host-ly-budget-oauth=' + encodeURIComponent(expired),
      },
    },
  ]
  for (const req of cases) {
    const result = response()
    await f.routes['/auth/google/callback'](req, result)
    assert.equal(result.location, '/signin?error=google')
    assert.equal(cookies(result)['__Host-ly-budget-session'], undefined)
  }
  assert.equal(f.exchanges(), 0)
  assert.equal(f.writes(), 0)
})

test('nonce, verified email and authorized party are required after ID token validation', () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  for (const claims of [
    { ...claimsFor('nonce'), nonce: 'wrong' },
    { ...claimsFor('nonce'), email_verified: false },
    { ...claimsFor('nonce'), sub: '' },
    { ...claimsFor('nonce'), azp: 'other-client' },
  ])
    assert.throws(() => validateGoogleClaims(claims, 'nonce', clientId))
})

test('unlisted, disabled, ambiguous or differently-bound accounts never gain sessions or auto-register', async () => {
  for (const initial of [
    [],
    [{ ...member(), isActive: false }],
    [{ ...member(), googleSubject: 'someone-else' }],
    [member(), { ...member(), id: 2 }],
  ]) {
    let f
    f = await flow(initial, async () =>
      claimsFor(f.url.searchParams.get('nonce'))
    )
    const result = response()
    await f.routes['/auth/google/callback'](f.request, result)
    assert.equal(result.location, '/signin?error=google')
    assert.equal(cookies(result)['__Host-ly-budget-session'], undefined)
    assert.equal(f.writes(), 0)
  }
})

test('a failed token exchange or nonce check cannot issue a session or bind a User', async () => {
  for (const exchange of [
    async () => {
      throw new Error('Google rejected code')
    },
    async () => claimsFor('wrong-nonce'),
  ]) {
    const f = await flow(undefined, exchange)
    const result = response()
    await f.routes['/auth/google/callback'](f.request, result)
    assert.equal(result.location, '/signin?error=google')
    assert.equal(cookies(result)['__Host-ly-budget-session'], undefined)
    assert.equal(f.writes(), 0)
  }
})

test('non-Workspace third-party email requires an admin-prebound sub', async () => {
  const db = database()
  const claims = { ...claimsFor('nonce'), hd: undefined }
  await assert.rejects(findGoogleUser(db.context, claims))
  db.rows[0].googleSubject = claims.sub
  assert.equal((await findGoogleUser(db.context, claims)).itemId, '1')
  assert.equal(db.writes(), 0)
})

test('a concurrent first-login binding cannot be overwritten', async () => {
  const db = database()
  db.context.prisma.user.updateMany = async () => {
    db.rows[0].googleSubject = 'different-google-account'
    return { count: 0 }
  }
  await assert.rejects(findGoogleUser(db.context, claimsFor('nonce')))
  assert.equal(db.rows[0].googleSubject, 'different-google-account')
})

test('unexpected Host cannot influence OAuth redirects', async () => {
  const f = await flow(undefined, async () => {
    throw new Error('must not run')
  })
  const result = response()
  await f.routes['/auth/google'](
    {
      headers: {
        host: 'attacker.example',
        'x-forwarded-host': 'cms.example.com',
      },
    },
    result
  )
  assert.equal(result.location, 'https://cms.example.com/signin')
  assert.equal(result.headers['set-cookie'], undefined)
})

test('password-era cookies are rejected even with the current signing secret', async () => {
  const db = database([{ ...member(), googleSubject: 'google-member' }])
  const token = await Iron.seal(
    { listKey: 'User', itemId: 1, data: { role: 'admin' } },
    process.env.CMS_SESSION_SECRET,
    Iron.defaults
  )
  assert.equal(
    await createCmsSession().session.get({
      context: {
        ...db.context,
        req: {
          headers: {
            host: 'cms.example.com',
            cookie: '__Host-ly-budget-session=' + token,
          },
        },
      },
    }),
    undefined
  )
})

async function issuedSession() {
  const db = database([{ ...member(), googleSubject: 'google-member' }])
  const { session } = createCmsSession()
  const res = response()
  const token = await session.start({
    context: { res },
    data: {
      itemId: '1',
      email: 'member@example.com',
      googleSubject: 'google-member',
      data: { role: 'admin' },
      audience: 'https://attacker.example',
    },
  })
  const headers = {
    host: 'cms.example.com',
    cookie: `__Host-ly-budget-session=${token}`,
  }
  const get = (req) => session.get({ context: { ...db.context, req } })
  return { ...db, session, res, token, headers, get }
}

test('session injection via headers, URL, body, legacy names or duplicate cookies is rejected', async () => {
  const f = await issuedSession()
  assert.equal((await f.get({ headers: f.headers })).data.role, 'editor')
  const base = { host: 'cms.example.com' }
  for (const req of [
    {
      headers: base,
      query: { session: f.token, token: f.token, access_token: f.token },
    },
    { headers: base, body: { session: f.token, token: f.token } },
    {
      headers: {
        ...base,
        'x-session-token': f.token,
        'x-user-id': '1',
        'x-user-role': 'admin',
      },
    },
    { headers: { ...base, authorization: `Bearer ${f.token}` } },
    { headers: { ...f.headers, authorization: `Bearer ${f.token}` } },
    { headers: { ...f.headers, authorization: '' } },
    { headers: { ...base, cookie: `keystonejs-session=${f.token}` } },
    { headers: { ...base, cookie: `ly-budget-session-local=${f.token}` } },
    {
      headers: {
        ...base,
        cookie: `__Host-ly-budget-session=${JSON.stringify({
          itemId: '1',
          data: { role: 'admin' },
        })}`,
      },
    },
    {
      headers: {
        ...base,
        cookie: `__Host-ly-budget-session=forged; ${f.headers.cookie}`,
      },
    },
    {
      headers: {
        ...base,
        cookie: `${f.headers.cookie}; __Host-ly-budget-session=forged`,
      },
    },
    {
      headers: { ...base, cookie: `${f.headers.cookie}; ${f.headers.cookie}` },
    },
    { headers: { ...base, cookie: '__Host-ly-budget-session=%E0%A4%A' } },
    {
      headers: {
        ...base,
        cookie: '__Host-ly-budget-session=' + 'x'.repeat(4097),
      },
    },
    {
      headers: {
        ...base,
        cookie: `__Host-ly-budget-session=${f.token.slice(
          0,
          20
        )}X${f.token.slice(21)}`,
      },
    },
    {
      headers: base,
      session: {
        listKey: 'User',
        itemId: '1',
        data: { id: '1', role: 'admin' },
      },
    },
  ])
    assert.equal(await f.get(req), undefined, JSON.stringify(Object.keys(req)))
})

test('session and OAuth cookies enforce the host prefix contract and preserve other Set-Cookie headers', async () => {
  const f = await issuedSession()
  const login = await flow(undefined, async () => {
    throw new Error('unused')
  })
  for (const value of [
    f.res.headers['set-cookie'][0],
    login.start.headers['set-cookie'][0],
  ]) {
    assert.match(value, /^__Host-ly-budget-/)
    assert.match(value, /; Path=\/(?:;|$)/)
    assert.match(value, /; Secure(?:;|$)/)
    assert.match(value, /; HttpOnly(?:;|$)/)
    assert.match(value, /; SameSite=Lax(?:;|$)/)
    assert.doesNotMatch(value, /; Domain=/i)
  }
  const res = response()
  res.setHeader('Set-Cookie', 'another=value; Path=/')
  await f.session.end({ context: { res } })
  assert.equal(res.headers['set-cookie'][0], 'another=value; Path=/')
  assert.equal(cookies(res)['__Host-ly-budget-session'], '')
})

test('writes require exact CMS Origin and reject sibling sites, forged forwarding headers and missing Origin', async () => {
  const f = await issuedSession()
  for (const origin of [
    undefined,
    'null',
    'https://evil.example.com',
    'https://cms.example.com.attacker.test',
  ]) {
    assert.equal(
      await f.get({ method: 'POST', headers: { ...f.headers, origin } }),
      undefined
    )
  }
  for (const headers of [
    {
      ...f.headers,
      host: 'evil.example.com',
      'x-forwarded-host': 'cms.example.com',
    },
    { ...f.headers, host: undefined },
    {
      ...f.headers,
      origin: 'https://evil.example.com',
      'x-forwarded-host': 'cms.example.com',
    },
    {
      ...f.headers,
      origin: process.env.CMS_ORIGIN,
      'sec-fetch-site': 'same-site',
    },
    {
      ...f.headers,
      origin: process.env.CMS_ORIGIN,
      'sec-fetch-site': 'cross-site',
    },
  ])
    assert.equal(await f.get({ method: 'POST', headers }), undefined)
  const headers = {
    ...f.headers,
    origin: process.env.CMS_ORIGIN,
    'sec-fetch-site': 'same-origin',
  }
  assert.equal((await f.get({ method: 'POST', headers })).data.role, 'editor')
  const denied = response()
  await f.session.end({
    context: {
      req: { headers: { ...headers, origin: 'https://evil.example.com' } },
      res: denied,
    },
  })
  assert.equal(denied.headers['set-cookie'], undefined)
  const ended = response()
  await f.session.end({ context: { req: { headers }, res: ended } })
  assert.equal(cookies(ended)['__Host-ly-budget-session'], '')
})

test('dev tokens cannot become prod sessions even if CMS_SESSION_SECRET is accidentally shared', async () => {
  const f = await issuedSession()
  const originalOrigin = process.env.CMS_ORIGIN
  try {
    process.env.CMS_ORIGIN = 'https://prod.example.com'
    const other = createCmsSession().session
    assert.equal(
      await other.get({
        context: {
          ...f.context,
          req: { headers: { ...f.headers, host: 'prod.example.com' } },
        },
      }),
      undefined
    )
  } finally {
    process.env.CMS_ORIGIN = originalOrigin
  }
  const originalSecret = process.env.CMS_SESSION_SECRET
  try {
    process.env.CMS_SESSION_SECRET = randomBytes(48).toString('hex')
    assert.equal(
      await createCmsSession().session.get({
        context: {
          ...f.context,
          req: { headers: f.headers },
        },
      }),
      undefined
    )
  } finally {
    process.env.CMS_SESSION_SECRET = originalSecret
  }
})

test('sessions expire server-side and login replaces any incoming token with a fresh session', async () => {
  const f = await issuedSession()
  const now = Date.now
  try {
    Date.now = () => now() + 86401000
    assert.equal(await f.get({ headers: f.headers }), undefined)
  } finally {
    Date.now = now
  }
  let login
  login = await flow(undefined, async () =>
    claimsFor(login.url.searchParams.get('nonce'))
  )
  login.request.headers.cookie +=
    '; __Host-ly-budget-session=attacker-chosen-token'
  login.request.query.session = 'attacker-chosen-token'
  login.request.query.id_token = 'attacker-id-token'
  const res = response()
  await login.routes['/auth/google/callback'](login.request, res)
  assert.equal(res.location, '/')
  const token = cookies(res)['__Host-ly-budget-session']
  assert.ok(token)
  assert.notEqual(token, 'attacker-chosen-token')
  assert.notEqual(token, f.token)
  assert.equal(
    (
      await login.session.get({
        context: {
          ...login.context,
          req: {
            headers: {
              host: 'cms.example.com',
              cookie: `__Host-ly-budget-session=${token}`,
            },
          },
        },
      })
    ).data.role,
    'editor'
  )
})

test('duplicate and foreign-environment OAuth transaction cookies never reach Google token exchange', async () => {
  const f = await flow(undefined, async () => {
    throw new Error('must not run')
  })
  for (const value of [
    `${f.request.headers.cookie}; ${f.request.headers.cookie}`,
    `__Host-ly-budget-oauth=forged; ${f.request.headers.cookie}`,
    `${f.request.headers.cookie}; __Host-ly-budget-oauth=forged`,
  ]) {
    const res = response()
    await f.routes['/auth/google/callback'](
      { ...f.request, headers: { ...f.request.headers, cookie: value } },
      res
    )
    assert.equal(res.location, '/signin?error=google')
  }
  const originalOrigin = process.env.CMS_ORIGIN
  let foreignExchanges = 0
  try {
    process.env.CMS_ORIGIN = 'https://prod.example.com'
    const routes = {}
    registerGoogleOAuth(
      { get: (path, handler) => (routes[path] = handler) },
      f.context,
      f.session,
      async () => {
        foreignExchanges++
        throw new Error('must not run')
      }
    )
    const res = response()
    await routes['/auth/google/callback'](
      {
        ...f.request,
        headers: { ...f.request.headers, host: 'prod.example.com' },
      },
      res
    )
    assert.equal(res.location, '/signin?error=google')
    assert.equal(cookies(res)['__Host-ly-budget-session'], undefined)
  } finally {
    process.env.CMS_ORIGIN = originalOrigin
  }
  assert.equal(foreignExchanges, 0)
  assert.equal(f.exchanges(), 0)
})

test('real Google JWT verifier rejects bad signatures, issuer, audience and expired tokens', async () => {
  const config = readGoogleOAuthConfig()
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const cert = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const originalCerts = OAuth2Client.prototype.getFederatedSignonCertsAsync
  const originalFetch = global.fetch
  OAuth2Client.prototype.getFederatedSignonCertsAsync = async () => ({
    certs: { test: cert },
  })
  let jwt
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    assert.equal(options.body.get('code_verifier'), 'verifier')
    assert.equal(options.body.get('redirect_uri'), config.redirectUri)
    return { ok: true, json: async () => ({ id_token: jwt }) }
  }
  const now = Math.floor(Date.now() / 1000)
  const base = {
    ...claimsFor('nonce'),
    iss: 'https://accounts.google.com',
    aud: config.clientId,
    iat: now,
    exp: now + 3600,
  }
  function token(payload) {
    const input =
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString(
        'base64url'
      ) +
      '.' +
      Buffer.from(JSON.stringify(payload)).toString('base64url')
    return (
      input +
      '.' +
      sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString(
        'base64url'
      )
    )
  }
  try {
    jwt = token(base)
    assert.equal(
      (await exchangeGoogleCode('code', 'verifier', config)).sub,
      'google-member'
    )
    for (const candidate of [
      token({ ...base, aud: 'wrong-client' }),
      token({ ...base, iss: 'https://attacker.example' }),
      token({ ...base, iat: now - 7200, exp: now - 3600 }),
      token(base).slice(0, -10) + 'AAAAAAAAAA',
    ]) {
      jwt = candidate
      await assert.rejects(exchangeGoogleCode('code', 'verifier', config))
    }
  } finally {
    global.fetch = originalFetch
    OAuth2Client.prototype.getFederatedSignonCertsAsync = originalCerts
  }
})
