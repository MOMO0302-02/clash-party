import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const get = vi.fn()
  const instance = {
    get,
    interceptors: { response: { use: vi.fn() } }
  }
  return {
    get,
    create: vi.fn(() => instance)
  }
})

vi.mock('axios', () => ({ default: { create: mocks.create } }))
vi.mock('electron', () => ({ app: { isReady: () => true } }))
vi.mock('../config', () => ({
  getAppConfig: vi.fn(),
  getControledMihomoConfig: vi.fn(async () => ({ mode: 'rule' })),
  manageSmartOverride: vi.fn()
}))
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('../resolve/tray', () => ({ tray: null }))
vi.mock('../resolve/floatingWindow', () => ({ floatingWindow: null }))
vi.mock('../traffic/recorder', () => ({ recordTrafficUsage: vi.fn() }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() })
}))
vi.mock('../utils/dirs', () => ({ mihomoWorkConfigPath: vi.fn() }))
vi.mock('./factory', () => ({ generateProfile: vi.fn(), getRuntimeConfig: vi.fn() }))
vi.mock('./dnsOverrideGuard', () => ({ syncControlDnsAfterApply: vi.fn() }))
vi.mock('./manager', () => ({
  getMihomoIpcPath: vi.fn(() => 'mihomo-test.pipe'),
  hasCoreProcess: vi.fn(() => true),
  restartCore: vi.fn()
}))

import { getRuntimeConfig } from './factory'
import { mihomoGroups } from './mihomoApi'

const group = {
  name: 'AUTO',
  all: ['provider-node'],
  hidden: false
} as IMihomoGroup
const globalGroup = { ...group, name: 'GLOBAL', all: [] } as IMihomoGroup

const providerProxy = {
  name: 'provider-node',
  type: 'http'
} as IMihomoProxy

describe('mihomoGroups provider resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRuntimeConfig).mockResolvedValue({
      'proxy-groups': [{ name: 'AUTO', use: ['provider'] }]
    } as IMihomoConfig)
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/proxies') {
        return { proxies: { AUTO: group, GLOBAL: globalGroup } }
      }
      if (path === '/providers/proxies/provider') {
        throw { response: { status: 404 } }
      }
      if (path === '/providers/proxies') {
        return { providers: { provider: { name: 'provider', proxies: [providerProxy] } } }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
  })

  it('falls back to the bulk provider list after a stale provider detail 404', async () => {
    const groups = await mihomoGroups()

    expect(groups[0].all).toContainEqual(providerProxy)
    expect(mocks.get).toHaveBeenCalledWith('/providers/proxies/provider')
    expect(mocks.get).toHaveBeenCalledWith('/providers/proxies')
  })
})
