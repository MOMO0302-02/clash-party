import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { managerLogger } from '../utils/logger'
import { getAxios } from './mihomoApi'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)

// 常量
const CORE_READY_MAX_RETRIES = 30
const CORE_READY_RETRY_INTERVAL_MS = 100
const CORE_PROCESS_NAMES = ['mihomo', 'mihomo-alpha', 'mihomo-smart'] as const

export async function cleanupSocketFile(): Promise<void> {
  if (process.platform === 'win32') {
    await cleanupWindowsNamedPipes()
  } else {
    await cleanupUnixSockets()
  }
}

// thorough=true 走 PowerShell 慢路径，仅在外部控制器监听冲突时使用
export async function cleanupWindowsNamedPipes(thorough = false): Promise<void> {
  if (!thorough) {
    try {
      const { stdout } = await execFilePromise(
        'tasklist',
        ['/FI', 'IMAGENAME eq mihomo*', '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1500, maxBuffer: 1 * 1024 * 1024 }
      )

      const pids: number[] = []
      for (const line of stdout.split('\n')) {
        const match = line.match(/^"([^"]+)","(\d+)"/)
        if (!match) continue
        const pid = parseInt(match[2], 10)
        if (!isNaN(pid) && pid !== process.pid) pids.push(pid)
      }

      if (pids.length === 0) return

      for (const pid of pids) {
        await terminateProcess(pid)
      }

      // 给进程留出退出窗口，避免 pipe 占用导致后续启动失败
      await new Promise((resolve) => setTimeout(resolve, 200))
    } catch (error) {
      managerLogger.warn('Lightweight pipe cleanup failed:', error)
    }
    return
  }

  try {
    try {
      const { stdout } = await execPromise(
        `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object {$_.ProcessName -like '*mihomo*'} | Select-Object Id,ProcessName | ConvertTo-Json"`,
        { encoding: 'utf8' }
      )

      if (stdout.trim()) {
        managerLogger.info(`Found potential pipe-blocking processes: ${stdout}`)

        try {
          const processes = JSON.parse(stdout)
          const processArray = Array.isArray(processes) ? processes : [processes]

          for (const proc of processArray) {
            const pid = proc.Id
            if (pid && pid !== process.pid) {
              await terminateProcess(pid)
            }
          }
        } catch (parseError) {
          managerLogger.warn('Failed to parse process list JSON:', parseError)
          await fallbackTextParsing(stdout)
        }
      }
    } catch (error) {
      managerLogger.warn('Failed to check mihomo processes:', error)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  } catch (error) {
    managerLogger.error('Windows named pipe cleanup failed:', error)
  }
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 0)
    process.kill(pid, 'SIGTERM')
    managerLogger.info(`Terminated process ${pid} to free pipe`)
  } catch (error: unknown) {
    if ((error as { code?: string })?.code !== 'ESRCH') {
      managerLogger.warn(`Failed to terminate process ${pid}:`, error)
    }
  }
}

async function fallbackTextParsing(stdout: string): Promise<void> {
  const lines = stdout.split('\n').filter((line) => line.includes('mihomo'))
  for (const line of lines) {
    // 旧实现取行内第一个数字就当 PID 杀，PowerShell 输出格式一变就可能误杀无关进程。
    // 这里只认 Id 字段，并且杀之前必须确认目标确实是内核进程。
    const match = line.match(/"?\bId"?\s*[:=]\s*"?(\d+)/i)
    if (!match) continue

    const pid = parseInt(match[1], 10)
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
    if (!(await verifyProcessOwner(pid, CORE_PROCESS_NAMES))) {
      managerLogger.info(`PID ${pid} is not a known mihomo process, skipping terminate`)
      continue
    }

    await terminateProcess(pid)
  }
}

// 与 getMihomoIpcPath() 生成的 `/tmp/mihomo-party-<uid>-<pid>.sock` 保持一致。
const UNIX_SOCKET_DIR = '/tmp'
const UNIX_SOCKET_PATTERN = /^mihomo-party-(\d+|unknown)-(\d+)\.sock$/
const LEGACY_UNIX_SOCKETS = ['/tmp/mihomo-party.sock', '/tmp/mihomo-party-admin.sock']

async function removeSocketFile(socketPath: string): Promise<void> {
  try {
    if (existsSync(socketPath)) {
      await rm(socketPath)
      managerLogger.info(`Cleaned up socket file: ${socketPath}`)
    }
  } catch (error) {
    managerLogger.warn(`Failed to cleanup socket file ${socketPath}:`, error)
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 说明进程存在但不属于当前用户，不能当作已退出
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export async function cleanupUnixSockets(): Promise<void> {
  try {
    for (const socketPath of LEGACY_UNIX_SOCKETS) {
      await removeSocketFile(socketPath)
    }

    // 旧实现只删几个固定名字，和实际带 uid/pid 的 socket 名对不上，
    // 结果 /tmp 下的 socket 会一直累积。这里按命名规则回收自己的和已退出进程的残留。
    const entries = await readdir(UNIX_SOCKET_DIR).catch(() => [] as string[])
    for (const entry of entries) {
      const match = UNIX_SOCKET_PATTERN.exec(entry)
      if (!match) continue

      const pid = parseInt(match[2], 10)
      if (pid !== process.pid && isPidAlive(pid)) continue

      await removeSocketFile(join(UNIX_SOCKET_DIR, entry))
    }
  } catch (error) {
    managerLogger.error('Unix socket cleanup failed:', error)
  }
}

export async function validateWindowsPipeAccess(pipePath: string): Promise<void> {
  try {
    managerLogger.info(`Validating pipe access for: ${pipePath}`)
    managerLogger.info(`Pipe validation completed for: ${pipePath}`)
  } catch (error) {
    managerLogger.error('Windows pipe validation failed:', error)
  }
}

export async function waitForCoreReady(): Promise<void> {
  for (let i = 0; i < CORE_READY_MAX_RETRIES; i++) {
    try {
      const axios = await getAxios(true)
      await axios.get('/')
      managerLogger.info(
        `Core ready after ${i + 1} attempts (${(i + 1) * CORE_READY_RETRY_INTERVAL_MS}ms)`
      )
      return
    } catch {
      if (i === 0) {
        managerLogger.info('Waiting for core to be ready...')
      }

      if (i === CORE_READY_MAX_RETRIES - 1) {
        managerLogger.warn(
          `Core not ready after ${CORE_READY_MAX_RETRIES} attempts, proceeding anyway`
        )
        return
      }

      await new Promise((resolve) => setTimeout(resolve, CORE_READY_RETRY_INTERVAL_MS))
    }
  }
}

function normalizeProcessName(name: string): string {
  return name
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase()
}

export async function verifyProcessOwner(
  pid: number,
  expectedNames: readonly string[]
): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  try {
    let processName = ''
    if (process.platform === 'win32') {
      const { stdout } = await execFilePromise(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 1000 }
      )
      const match = stdout.match(/^"([^"]+)","(\d+)"/m)
      if (!match || parseInt(match[2], 10) !== pid) return false
      processName = match[1]
    } else {
      const { stdout } = await execFilePromise('ps', ['-p', `${pid}`, '-o', 'comm='], {
        timeout: 1000
      })
      processName = stdout.trim().split(/\r?\n/, 1)[0] || ''
    }

    const normalizedName = normalizeProcessName(processName)
    return expectedNames.some((name) => normalizeProcessName(name) === normalizedName)
  } catch {
    return false
  }
}
