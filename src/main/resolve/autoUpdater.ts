import { copyFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import os from 'os'
import { exec, execFile, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { app, shell } from 'electron'
import i18next from 'i18next'
import { mainWindow } from '../window'
import { appLogger } from '../utils/logger'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'
import { checkAdminPrivileges } from '../core/manager'
import { parse } from '../utils/yaml'
import * as chromeRequest from '../utils/chromeRequest'

const GITHUB_PROXIES = [
  'https://gh-proxy.org',
  'https://ghfast.top',
  'https://down.clashparty.org',
  'https://download.mihomo.party'
]

let updateInstallPromise: Promise<void> | undefined

interface GitHubReleaseAsset {
  name: string
  digest?: string
}

interface GitHubRelease {
  assets?: GitHubReleaseAsset[]
}

function buildDownloadUrls(githubUrl: string, proxyPref = ''): string[] {
  if (proxyPref === 'direct') return [githubUrl]
  if (proxyPref && proxyPref !== 'auto') return [`${proxyPref}/${githubUrl}`]
  // auto: try each proxy then fall back to direct
  return [...GITHUB_PROXIES.map((p) => `${p}/${githubUrl}`), githubUrl]
}

async function tryDownload(
  urls: string[],
  options: Parameters<typeof chromeRequest.get>[1]
): Promise<Awaited<ReturnType<typeof chromeRequest.get>>> {
  let lastError: unknown
  for (const url of urls) {
    try {
      const res = await chromeRequest.get(url, options)
      // chromeRequest 只在网络层出错时 reject，HTTP 4xx/5xx 一样会 resolve。
      // 不判断状态码的话，某个镜像返回的错误页会被当成正文直接返回，
      // 后面的镜像再也不会被尝试，调用方拿到的是一段 HTML。
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`)
      }
      return res
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

async function getGitHubAssetSha256(
  version: string,
  file: string,
  proxy: { protocol: 'http'; host: string; port: number }
): Promise<string> {
  const releaseTag = encodeURIComponent(`v${version}`)
  const res = await chromeRequest.get<GitHubRelease>(
    `https://api.github.com/repos/mihomo-party-org/mihomo-party/releases/tags/${releaseTag}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      proxy,
      timeout: 5000,
      responseType: 'json'
    }
  )
  const digest = res.data.assets?.find((asset) => asset.name === file)?.digest
  const match = digest?.match(/^sha256:([a-f\d]{64})$/i)
  if (!match) {
    throw new Error(`GitHub Release does not provide a SHA-256 digest for "${file}"`)
  }
  return match[1].toLowerCase()
}

export async function checkUpdate(): Promise<IAppVersion | undefined> {
  const [{ 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed }, { githubProxy = '' }] =
    await Promise.all([getControledMihomoConfig(), getAppConfig()])
  const githubUrl =
    'https://github.com/mihomo-party-org/mihomo-party/releases/latest/download/latest.yml'
  const res = await tryDownload(buildDownloadUrls(githubUrl, githubProxy), {
    headers: { 'Content-Type': 'application/octet-stream' },
    proxy: { protocol: 'http', host: '127.0.0.1', port: mixedPort },
    responseType: 'text'
  })
  const latest = parse(res.data as string) as IAppVersion
  const currentVersion = app.getVersion()
  if (compareVersions(latest.version, currentVersion) > 0) {
    return latest
  } else {
    return undefined
  }
}

// 1:新 -1:旧 0:相同
function compareVersions(a: string, b: string): number {
  const parsePart = (part: string) => {
    const numPart = part.split('-')[0]
    const num = parseInt(numPart, 10)
    return isNaN(num) ? 0 : num
  }
  const v1 = a.replace(/^v/, '').split('.').map(parsePart)
  const v2 = b.replace(/^v/, '').split('.').map(parsePart)
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const num1 = v1[i] || 0
    const num2 = v2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

export function downloadAndInstallUpdate(version: string): Promise<void> {
  if (updateInstallPromise) return updateInstallPromise

  // 成功时也要清空：pkg 分支在 osascript 失败后会退回 shell.openPath 并正常 resolve，
  // 此时应用并没有退出。若不清空，之后再点「更新」拿到的都是这个已完成的 promise，
  // 按钮变成永远没反应。
  updateInstallPromise = installUpdate(version).finally(() => {
    updateInstallPromise = undefined
  })
  return updateInstallPromise
}

async function installUpdate(version: string): Promise<void> {
  const [{ 'mixed-port': mixedPort = DEFAULT_MIHOMO_PORTS.mixed }, { githubProxy = '' }] =
    await Promise.all([getControledMihomoConfig(), getAppConfig()])
  const githubBase = `https://github.com/mihomo-party-org/mihomo-party/releases/download/v${version}/`
  const fileMap = {
    'win32-x64': `clash-party-windows-${version}-x64-setup.exe`,
    'win32-ia32': `clash-party-windows-${version}-ia32-setup.exe`,
    'win32-arm64': `clash-party-windows-${version}-arm64-setup.exe`,
    'darwin-x64': `clash-party-macos-${version}-x64.pkg`,
    'darwin-arm64': `clash-party-macos-${version}-arm64.pkg`
  }
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  if (!file) {
    throw new Error(i18next.t('common.error.autoUpdateNotSupported'))
  }
  if (process.platform === 'win32' && parseInt(os.release()) < 10) {
    file = file.replace('windows', 'win7')
  }
  if (process.platform === 'darwin') {
    const productVersion = execSync('sw_vers -productVersion', { encoding: 'utf8' })
      .toString()
      .trim()
    if (parseInt(productVersion) < 11) {
      file = file.replace('macos', 'catalina')
    }
  }
  const proxy = { protocol: 'http' as const, host: '127.0.0.1', port: mixedPort }
  try {
    if (!existsSync(path.join(dataDir(), file))) {
      let expectedHash: string
      try {
        expectedHash = await getGitHubAssetSha256(version, file, proxy)
      } catch (e) {
        await appLogger.warn(
          'Failed to get update SHA-256 from GitHub API, falling back to release checksum file',
          e
        )
        const sha256Res = await tryDownload(
          buildDownloadUrls(`${githubBase}${file}.sha256`, githubProxy),
          { proxy, responseType: 'text' }
        )
        expectedHash = (sha256Res.data as string).trim().split(/\s+/)[0]
      }
      // 进度只允许单调递增，避免多代理重试导致进度回退抽搐
      let lastPercent = -1
      const res = await tryDownload(buildDownloadUrls(`${githubBase}${file}`, githubProxy), {
        responseType: 'arraybuffer',
        timeout: 0,
        proxy,
        headers: { 'Content-Type': 'application/octet-stream' },
        onProgress: (loaded: number, total: number) => {
          const percent = Math.round((loaded / total) * 100)
          if (percent <= lastPercent) return
          lastPercent = percent
          mainWindow?.webContents.send('updateDownloadProgress', {
            status: 'downloading',
            percent
          })
        }
      })
      mainWindow?.webContents.send('updateDownloadProgress', { status: 'verifying' })
      const fileBuffer = Buffer.from(res.data as ArrayBuffer)
      const actualHash = createHash('sha256').update(fileBuffer).digest('hex')
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(`File integrity check failed: expected ${expectedHash}, got ${actualHash}`)
      }
      await writeFile(path.join(dataDir(), file), fileBuffer)
    }
    if (file.endsWith('.exe')) {
      try {
        const installerPath = path.join(dataDir(), file)
        const installerArgs = ['/S', '--updated', '--force-run']
        const isAdmin = await checkAdminPrivileges()

        if (isAdmin) {
          await appLogger.info('Running installer with existing admin privileges')
          spawn(installerPath, installerArgs, {
            detached: true,
            stdio: 'ignore'
          }).unref()
        } else {
          // 提升权限安装
          const escapedPath = installerPath.replace(/'/g, "''")
          const argsString = installerArgs.map((arg) => arg.replace(/'/g, "''")).join("', '")

          const command = `powershell  -NoProfile -Command "Start-Process -FilePath '${escapedPath}' -ArgumentList '${argsString}' -Verb RunAs -WindowStyle Hidden"`

          await appLogger.info('Starting installer with elevated privileges')

          const execPromise = promisify(exec)
          await execPromise(command, { windowsHide: true })

          await appLogger.info('Installer started successfully with elevation')
        }
        app.quit()
      } catch (installerError) {
        await appLogger.error('Failed to start installer, trying fallback', installerError)

        // Fallback: 尝试使用 shell.openPath 打开安装包
        try {
          await shell.openPath(path.join(dataDir(), file))
          await appLogger.info('Opened installer with shell.openPath as fallback')
        } catch (fallbackError) {
          await appLogger.error('Fallback method also failed', fallbackError)
          const installerErrorMessage =
            installerError instanceof Error ? installerError.message : String(installerError)
          const fallbackErrorMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          throw new Error(
            `Failed to execute installer: ${installerErrorMessage}. Fallback also failed: ${fallbackErrorMessage}`
          )
        }
      }
    }
    if (file.endsWith('.7z')) {
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      app.quit()
    }
    if (file.endsWith('.pkg')) {
      try {
        const execFilePromise = promisify(execFile)
        // 用单引号包住路径并转义内部单引号，交给 shell 的是一个完整参数。
        // 旧写法 `.replace(' ', '\\\\ ')` 用字符串做模式，只会转义第一个空格，
        // 而 macOS 的数据目录是 ~/Library/Application Support/... ，空格不止一个。
        const pkgPath = path.join(dataDir(), file)
        const shellCommand = `installer -pkg '${pkgPath.replace(/'/g, `'\\''`)}' -target /`
        // AppleScript 字符串里的反斜杠和双引号都要转义，否则命令会被截断
        const appleScriptLiteral = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const command = `do shell script "${appleScriptLiteral}" with administrator privileges`
        await execFilePromise('osascript', ['-e', command])
        app.relaunch()
        app.quit()
      } catch {
        shell.openPath(path.join(dataDir(), file))
      }
    }
  } catch (e) {
    await appLogger.error('Failed to download or install update', e)
    await rm(path.join(dataDir(), file), { force: true }).catch((removeError) =>
      appLogger.warn('Failed to remove failed update file', removeError)
    )
    throw e
  }
}
