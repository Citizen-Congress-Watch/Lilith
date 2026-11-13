const assert = require('node:assert/strict')
const { test } = require('node:test')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Run the actual TS configuration with the project's existing TypeScript dependency.
require.extensions['.ts'] = (module, filename) => {
  // Image generation is unrelated to auth; do not load native sharp or cloud clients.
  if (filename.endsWith('/proposal-image-thumbnail.ts')) {
    module.exports = {
      proposalImageThumbnailHandler() {
        throw new Error('Unexpected thumbnail request in security test')
      },
    }
    return
  }
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(result.outputText, filename)
}
const { createSystem, initConfig } = require('@keystone-6/core/system')
const { graphql, validateSchema } = require('graphql')
const Iron = require('@hapi/iron')
const root = path.resolve(__dirname, '..')
function load(strategy) {
  process.env.ACCESS_CONTROL_STRATEGY = strategy
  process.env.IS_CACHE_ENABLED = 'false'
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(root + path.sep) && filename.endsWith('.ts'))
      delete require.cache[filename]
  }
  return require('../keystone.ts').default
}
function identity(role, id = '1') {
  return { listKey: 'User', itemId: id, data: { id, name: 'same-name', role } }
}

for (const strategy of ['gql', 'preview']) {
  test(`${strategy}: all lists deny writes, accounts/auth are hidden, GraphQL rejects writes`, async () => {
    const config = load(strategy)
    assert.equal(config.session, undefined)
    assert.equal(config.ui.isDisabled, true)
    for (const [name, list] of Object.entries(config.lists)) {
      for (const session of [
        undefined,
        identity('admin'),
        { data: { role: 'admin' } },
      ]) {
        for (const operation of ['create', 'update', 'delete']) {
          assert.equal(
            await list.access.operation[operation]({ session }),
            false,
            `${name}.${operation}`
          )
        }
      }
    }
    const { graphQLSchema: schema } = createSystem(initConfig(config))
    assert.deepEqual(validateSchema(schema), [])
    assert.deepEqual(Object.keys(schema.getMutationType().getFields()), [
      '_readOnly',
    ])
    assert.equal(schema.getQueryType().getFields().users, undefined)
    assert.equal(schema.getQueryType().getFields().authenticatedItem, undefined)
    const query = await graphql({ schema, source: '{ __typename }' })
    assert.equal(query.data.__typename, 'Query')
    for (const source of [
      'mutation { createRecognitionImage(data: {}) { id } }',
      'mutation { updateRecognitionStatus(where: {id:"1"}, data: {}) { id } }',
      'mutation { deleteProposal(where: {id:"1"}) { id } }',
      'mutation { createUser(data: {name:"attacker"}) { id } }',
      'mutation { authenticateUserWithPassword(email:"a",password:"b") { __typename } }',
      'mutation { createInitialUser(data: {}) { id } }',
      'mutation { alias: _readOnly }',
    ]) {
      const result = await graphql({ schema, source })
      assert.ok(result.errors?.length, source)
    }
    // Building Keystone's real context catches incompatibilities with omitted mutations.
    class NoDatabaseClient {}
    const context = createSystem(initConfig(config)).getKeystone({
      PrismaClient: NoDatabaseClient,
      Prisma: {},
    }).context
    await assert.rejects(async () =>
      context.db.Proposal.createOne({ data: {} })
    )
  })
}

test('CMS rejects anonymous/invalid identities and enforces account ownership and role controls', async () => {
  const config = load('cms')
  const access = require('../access.ts')
  const { graphQLSchema: schema } = createSystem(initConfig(config))
  assert.deepEqual(validateSchema(schema), [])
  assert.ok(schema.getMutationType().getFields().authenticateUserWithPassword)
  assert.equal(
    schema.getMutationType().getFields().createInitialUser,
    undefined
  )
  for (const list of Object.values(config.lists)) {
    const operations = list.access.operation
    for (const operation of ['create', 'update', 'delete']) {
      const check =
        typeof operations === 'function' ? operations : operations[operation]
      for (const session of [
        undefined,
        {},
        { data: { role: 'admin' } },
        { ...identity('admin'), itemId: '2' },
        ...[0, -1, 1.5, NaN, Infinity, true, {}, ['1'], '01', '1.0'].map(
          (itemId) => ({ ...identity('admin'), itemId })
        ),
        { ...identity('admin'), listKey: 'Other' },
      ]) {
        assert.equal(await check({ session }), false)
      }
    }
  }
  assert.equal(access.gqlReadOnly()({ session: identity('editor') }), true)
  assert.equal(
    access.gqlReadAndCreate().create({ session: identity('editor') }),
    false
  )
  assert.equal(
    access.gqlReadAndCreate().create({ session: identity('moderator') }),
    true
  )
  assert.deepEqual(
    access.userUpdateFilter({ session: identity('editor', '7') }),
    { id: { equals: '7' } }
  )
  assert.deepEqual(
    access.userUpdateFilter({ session: identity('moderator') }),
    {
      AND: [
        { role: { not: { equals: 'admin' } } },
        { isProtected: { equals: false } },
      ],
    }
  )
  for (const field of ['role', 'isProtected']) {
    const definition = config.lists.User.fields[field]({
      listKey: 'User',
      fieldKey: field,
      lists: {},
      provider: 'postgresql',
    })
    for (const operation of ['create', 'update']) {
      assert.equal(
        definition.access[operation]({ session: identity('editor') }),
        false
      )
      assert.equal(
        definition.access[operation]({ session: identity('moderator') }),
        false
      )
      assert.equal(
        definition.access[operation]({ session: identity('admin') }),
        true
      )
    }
  }
})

test('session secrets fail closed; forged cookies/Bearer tokens and rotated tokens are rejected', async () => {
  load('cms')
  const {
    validateSessionSecret,
    readAccessControlStrategy,
    readSessionMaxAge,
  } = require('../security-config.ts')
  for (const value of [
    '',
    'short',
    'x'.repeat(64),
    'default_session_secret_and_it_should_be_more_than_32_characters',
  ]) {
    assert.throws(() => validateSessionSecret(value))
  }
  assert.throws(() => readAccessControlStrategy('typo'))
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '100abc'])
    assert.throws(() => readSessionMaxAge(value))
  const { createCmsSession } = require('../session.ts')
  delete process.env.CMS_SESSION_SECRET
  process.env.SESSION_SECRET = randomBytes(48).toString('hex')
  assert.throws(() => createCmsSession().initialize(), /CMS_SESSION_SECRET/)
  const config = load('cms')
  assert.throws(
    () => config.server.extendExpressApp({}, {}),
    /CMS_SESSION_SECRET/
  )
  process.env.CMS_SESSION_SECRET = randomBytes(48).toString('hex')
  process.env.NODE_ENV = 'production'
  const { session } = createCmsSession()
  let setCookie
  const token = await session.start({
    data: { listKey: 'User', itemId: '1' },
    context: {
      res: {
        setHeader: (name, value) => {
          setCookie = value
        },
      },
    },
  })
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /SameSite=Lax/)
  const get = (candidate, bearer = false) =>
    session.get({
      context: {
        req: {
          headers: bearer
            ? { authorization: `Bearer ${candidate}` }
            : { cookie: `keystonejs-session=${candidate}` },
        },
      },
    })
  assert.equal((await get(token)).itemId, '1')
  const forged = await Iron.seal(
    { listKey: 'User', itemId: '1', data: { role: 'admin' } },
    'default_session_secret_and_it_should_be_more_than_32_characters',
    Iron.defaults
  )
  for (const candidate of [
    forged,
    JSON.stringify(identity('admin')),
    token.slice(0, -1) + 'X',
  ]) {
    assert.equal(await get(candidate), undefined)
    assert.equal(await get(candidate, true), undefined)
  }
  process.env.CMS_SESSION_SECRET = randomBytes(48).toString('hex')
  const rotated = createCmsSession().session
  assert.equal(
    await rotated.get({
      context: { req: { headers: { authorization: `Bearer ${token}` } } },
    }),
    undefined
  )
})

test('anonymous CMS GraphQL mutations fail before reaching the database', async () => {
  const config = load('cms')
  class NoDatabaseClient {}
  const { context } = createSystem(initConfig(config)).getKeystone({
    PrismaClient: NoDatabaseClient,
    Prisma: {},
  })
  for (const source of [
    'mutation { createRecognitionImage(data: {}) { id } }',
    'mutation { updateRecognitionStatus(where: {id:"1"}, data: {}) { id } }',
    'mutation { deleteProposal(where: {id:"1"}) { id } }',
    'mutation { createUser(data: {}) { id } }',
    'mutation { updateUsers(data: [{where: {id:"1"}, data: {role:"admin"}}]) { id } }',
  ]) {
    const result = await context.graphql.raw({ query: source })
    assert.ok(result.errors?.length, source)
    assert.ok(
      result.errors.every(
        (error) => error.extensions.code === 'KS_ACCESS_DENIED'
      ),
      JSON.stringify(result.errors)
    )
  }
})

for (const itemId of [1, '1']) {
  test(`authenticated ${typeof itemId} IDs can access CMS, reload roles and reject deleted users`, async () => {
    const config = load('cms')
    process.env.CMS_SESSION_SECRET = randomBytes(32).toString('hex')
    const token = await config.session.start({
      data: { ...identity('admin'), itemId },
      context: { res: { setHeader() {} } },
    })
    const context = {
      req: { headers: { cookie: `keystonejs-session=${token}` } },
      sudo: () => ({
        query: {
          User: {
            findOne: async ({ where }) => {
              assert.equal(where.id, itemId)
              return { id: '1', name: 'same-name', role: 'contributor' }
            },
          },
        },
      }),
    }
    const session = await config.session.get({ context })
    assert.equal(session.data.role, 'contributor')
    const access = require('../access.ts')
    assert.equal(await config.ui.isAccessAllowed({ session }), true)
    assert.equal(access.isAdmin({ session }), false)
    context.sudo = () => ({
      query: { User: { findOne: async () => ({ id: '1', role: 'admin' }) } },
    })
    const adminSession = await config.session.get({ context })
    assert.equal(
      await config.ui.isAccessAllowed({ session: adminSession }),
      true
    )
    assert.equal(access.isAdmin({ session: adminSession }), true)
    assert.equal(
      access.isAdmin({ session: { ...adminSession, itemId: 2 } }),
      false
    )
    context.sudo = () => ({ query: { User: { findOne: async () => null } } })
    assert.equal(await config.session.get({ context }), undefined)
  })
}
