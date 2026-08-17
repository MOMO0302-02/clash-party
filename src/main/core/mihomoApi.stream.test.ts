import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// A stream that the core has nothing to say on yet — /connections while no
// connection is open is the common case — used to burn its entire retry budget
// on idle reconnects and then stay dead for the rest of the session, because
// the budget was only replenished by an incoming message.

const sockets: FakeSocket[] = []

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = FakeSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  removeAllListeners = vi.fn()
  close = vi.fn()
  terminate = vi.fn()

  constructor() {
    sockets.push(this)
  }

  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  drop(): void {
    this.readyState = 3
    this.onclose?.()
  }
}

vi.mock('ws', () => ({ default: FakeSocket }))
vi.mock('net', () => ({ createConnection: vi.fn(() => ({})) }))
vi.mock('electron', () => ({ app: { isReady: () => true } }))
vi.mock('axios', () => ({
  default: { create: () => ({ interceptors: { response: { use: vi.fn() } } }) }
}))
vi.mock('../config', () => ({ getAppConfig: vi.fn(), getControledMihomoConfig: vi.fn() }))
vi.mock('../window', () => ({ mainWindow: null }))
vi.mock('../resolve/tray', () => ({ tray: null }))
vi.mock('../resolve/floatingWindow', () => ({ floatingWindow: null }))
vi.mock('../utils/calc', () => ({ calcTraffic: () => '' }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/dirs', () => ({ mihomoWorkConfigPath: () => '' }))
vi.mock('./factory', () => ({ generateProfile: vi.fn(), getRuntimeConfig: vi.fn() }))
vi.mock('./manager', () => ({
  getMihomoIpcPath: () => '/tmp/fake.sock',
  hasCoreProcess: () => true,
  restartCore: vi.fn()
}))

describe('stream reconnect budget', () => {
  beforeEach(() => {
    sockets.length = 0
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps reconnecting past the retry cap when the socket opens but stays silent', async () => {
    const { startMihomoConnections } = await import('./mihomoApi')
    startMihomoConnections()

    // Far more idle open/close cycles than MAX_RETRY (10). Every cycle opens
    // successfully and never delivers a message, which is exactly the reported
    // scenario.
    for (let i = 0; i < 25; i++) {
      const socket = sockets[sockets.length - 1]
      expect(socket, `no socket for cycle ${i}`).toBeDefined()
      socket.open()
      socket.drop()
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(sockets.length).toBeGreaterThan(11)
  })

  it('still gives up when the socket never opens at all', async () => {
    const { startMihomoConnections } = await import('./mihomoApi')
    startMihomoConnections()

    for (let i = 0; i < 25; i++) {
      const socket = sockets[sockets.length - 1]
      if (!socket) break
      socket.drop()
      await vi.advanceTimersByTimeAsync(1000)
    }

    // A core that is genuinely unreachable must not be retried forever.
    expect(sockets.length).toBeLessThanOrEqual(11)
  })
})
