const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function startup(strategy, migrationFails = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ly-budget-startup-'))
  try {
    const log = path.join(temp, 'commands')
    fs.writeFileSync(path.join(temp, 'gcsfuse'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    })
    fs.writeFileSync(
      path.join(temp, 'yarn'),
      `#!/bin/sh
printf '%s:%s\\n' "\${ACCESS_CONTROL_STRATEGY:-cms}" "$*" >> "$STARTUP_TEST_LOG"
if [ "$*" = "run db-migrate" ]; then
  # Model the observed failure if the migration CLI sees a public schema.
  [ "\${ACCESS_CONTROL_STRATEGY:-cms}" = cms ] || exit 41
  [ "$STARTUP_TEST_FAIL_MIGRATION" != true ] || exit 42
fi
`,
      { mode: 0o755 }
    )
    const env = {
      ...process.env,
      PATH: `${temp}:${process.env.PATH}`,
      MNT_DIR: path.join(temp, 'mount with spaces'),
      GCS_BUCKET: 'test-bucket',
      STARTUP_TEST_LOG: log,
      STARTUP_TEST_FAIL_MIGRATION: String(migrationFails),
    }
    delete env.CMS_SESSION_SECRET
    delete env.SESSION_SECRET
    if (strategy === undefined) delete env.ACCESS_CONTROL_STRATEGY
    else env.ACCESS_CONTROL_STRATEGY = strategy
    const result = spawnSync('bash', [path.resolve(__dirname, '../run.sh')], {
      env,
      encoding: 'utf8',
    })
    return {
      ...result,
      commands: fs.existsSync(log)
        ? fs.readFileSync(log, 'utf8').trim().split('\n')
        : [],
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

for (const strategy of ['gql', 'preview']) {
  test(`${strategy} starts without migrations or session secrets`, () => {
    const result = startup(strategy)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.commands, [`${strategy}:start`])
  })
}

for (const strategy of ['cms', undefined, '']) {
  test(`CMS startup (${String(strategy)}) migrates before starting`, () => {
    const result = startup(strategy)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.commands, ['cms:run db-migrate', 'cms:start'])
  })
}

test('a failed CMS migration prevents startup', () => {
  const result = startup('cms', true)
  assert.equal(result.status, 42)
  assert.deepEqual(result.commands, ['cms:run db-migrate'])
})

test('an unknown strategy fails before migrations or startup', () => {
  const result = startup('gql-typo')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ACCESS_CONTROL_STRATEGY/)
  assert.deepEqual(result.commands, [])
})
