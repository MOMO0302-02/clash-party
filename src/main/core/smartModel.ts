import { copyFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { mihomoWorkDir, mihomoTestDir } from '../utils/dirs'
import { managerLogger } from '../utils/logger'

const MODEL_FILE = 'Model.bin'

async function isSourceNewer(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceStats, targetStats] = await Promise.all([stat(sourcePath), stat(targetPath)])
    return sourceStats.mtime > targetStats.mtime
  } catch {
    return true
  }
}

// Smart 内核在工作目录找不到 Model.bin 时会联网下载模型。而配置检查（mihomo -t）跑在独立的
// test 目录里，该目录从不包含模型；这次检查又发生在旧内核已经停止、系统代理已经撤下之后，
// 于是下载必然超时失败，每次重启白白多等约 20 秒，且失败不留文件，下次重启重演一遍。
// 正式工作目录已有模型时先同步过去，跳过这次注定失败的下载。
export async function syncSmartModelToTestDir(): Promise<void> {
  const source = path.join(mihomoWorkDir(), MODEL_FILE)
  if (!existsSync(source)) return

  const target = path.join(mihomoTestDir(), MODEL_FILE)
  if (existsSync(target) && !(await isSourceNewer(source, target))) return

  try {
    await copyFile(source, target)
  } catch (error) {
    managerLogger.warn('Failed to sync Model.bin into test dir', error)
  }
}
