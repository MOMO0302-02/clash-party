import { finish, ok, read, section } from './lib.mjs'

section('Windows TUN permission preflight ordering')
const source = read('src/main/index.ts')
const start = source.indexOf('const startPromises = await startCoreForStartup()')
const preflight = source.indexOf('await validateTunPermissionsOnStartup(async () => {})')
const adminFollowUp = source.indexOf('checkAdminRestartForTun().catch')

ok('preflight call exists', preflight >= 0)
ok('preflight runs before first core spawn', preflight >= 0 && start >= 0 && preflight < start)
ok(
  'preflight is Windows-only',
  /process\.platform\s*===\s*[''`]win32[''`]/.test(source.slice(Math.max(0, preflight - 240), preflight))
)
ok(
  'admin restart flag skips preflight',
  /!process\.argv\.includes\(\s*[''`]--admin-restart-for-tun[''`]\s*\)/.test(
    source.slice(Math.max(0, preflight - 240), preflight)
  )
)
ok('post-start admin restart flow remains after spawn', adminFollowUp > start)

finish('p2190-tun-permission-order')