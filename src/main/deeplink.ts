import { Notification } from 'electron'
import i18next from 'i18next'
import { addProfileItem, getProfileConfig } from './config'
import { installRemotePlugin, loginPlugin } from './resolve/plugin'
import { mainWindow } from './window'
import { safeShowErrorBox } from './utils/init'

export function findDeepLink(args: string[]): string | undefined {
  return args.find((arg) => {
    const lower = arg.toLowerCase()
    return lower.startsWith('clash://') || lower.startsWith('mihomo://')
  })
}

export async function handleDeepLink(url: string): Promise<void> {
  if (!findDeepLink([url])) return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        await addProfileItem({
          type: 'remote',
          name: profileName ?? undefined,
          url: profileUrl
        })
        mainWindow?.webContents.send('profileConfigUpdated')
        new Notification({ title: i18next.t('profiles.notification.importSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('profiles.error.importFailed', `${url}\n${e}`)
      }
      break
    }
    // 供系统计划任务使用：clash://update-config 刷新全部远程订阅，
    // 带 ?id= 或 ?name= 时只刷新指定的一条。应用已在运行时不会弹出主窗口。
    case 'update-config': {
      try {
        const id = urlObj.searchParams.get('id')
        const name = urlObj.searchParams.get('name')
        const { items } = await getProfileConfig()
        const remoteItems = items.filter((item) => item.type === 'remote')
        const targets =
          id || name
            ? remoteItems.filter((item) => (id ? item.id === id : item.name === name))
            : remoteItems
        if (targets.length === 0) {
          throw new Error(i18next.t('profiles.error.noMatchingProfile'))
        }
        const failures: string[] = []
        for (const item of targets) {
          try {
            await addProfileItem(item)
          } catch (e) {
            failures.push(`${item.name}: ${e}`)
          }
        }
        mainWindow?.webContents.send('profileConfigUpdated')
        if (failures.length > 0) {
          throw new Error(failures.join('\n'))
        }
        new Notification({ title: i18next.t('profiles.notification.updateSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('common.error.updateProfileFailed', `${url}\n${e}`)
      }
      break
    }
    case 'install-plugin': {
      let plugin: IPluginItem
      try {
        const pluginUrl = urlObj.searchParams.get('url')
        if (!pluginUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        plugin = await installRemotePlugin(pluginUrl)
        new Notification({ title: i18next.t('plugins.installed') }).show()
      } catch (e) {
        safeShowErrorBox('plugins.installFailed', `${e}`)
        break
      }

      try {
        await loginPlugin(plugin.id)
        new Notification({ title: i18next.t('plugins.loginSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('plugins.loginFailed', `${e}`)
      }
      break
    }
  }
}
