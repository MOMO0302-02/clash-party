import { finish, ok, read, section } from './lib.mjs'

section('Windows TUN permission preflight ordering')
const source = read('src/main/index.ts')
const preflightCall = 'await validateTunPermissionsOnStartup(async () => {})'

function orderingPasses(text) {
  const start = text.indexOf('const startPromises = await startCoreForStartup()')
  const preflight = text.indexOf(preflightCall)
  const adminFollowUp = text.indexOf('checkAdminRestartForTun().catch')
  const context = text.slice(Math.max(0, preflight - 240), preflight)
  return (
    preflight >= 0 &&
    start >= 0 &&
    preflight < start &&
    adminFollowUp > start &&
    /process\.platform\s*===\s*[''`]win32[''`]/.test(context) &&
    /!process\.argv\.includes\(\s*[''`]--admin-restart-for-tun[''`]\s*\)/.test(context)
  )
}

const start = source.indexOf('const startPromises = await startCoreForStartup()')
const preflight = source.indexOf(preflightCall)
const adminFollowUp = source.indexOf('checkAdminRestartForTun().catch')
const context = source.slice(Math.max(0, preflight - 240), preflight)

ok('preflight call exists', preflight >= 0)
ok('preflight runs before first core spawn', preflight >= 0 && start >= 0 && preflight < start)
ok('preflight is Windows-only', /process\.platform\s*===\s*[''`]win32[''`]/.test(context))
ok(
  'admin restart flag skips preflight',
  /!process\.argv\.includes\(\s*[''`]--admin-restart-for-tun[''`]\s*\)/.test(context)
)
ok('post-start admin restart flow remains after spawn', adminFollowUp > start)

// Mutation checks: the probe must reject both unsafe regressions.
const removedPreflight = source.replace(preflightCall, '')
const movedAfterSpawn = removedPreflight.replace(
  'const startPromises = await startCoreForStartup()',
  `${preflightCall}\n        const startPromises = await startCoreForStartup()`
)
ok('mutation removing preflight is rejected', !orderingPasses(removedPreflight))
ok('mutation moving preflight after spawn is rejected', !orderingPasses(movedAfterSpawn))

finish('p2190-tun-permission-order')