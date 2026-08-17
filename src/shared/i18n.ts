import i18next from 'i18next'
import enUS from '../renderer/src/locales/en-US.json'
import zhCN from '../renderer/src/locales/zh-CN.json'

// en-US and zh-CN stay bundled: safeShowErrorBox() needs a translation
// synchronously, before i18next has been initialised. The remaining locales are
// loaded on demand, so a build no longer carries every translation into both the
// main and the renderer bundle when only one language is ever active.
export const resources = {
  'en-US': {
    translation: enUS
  },
  'zh-CN': {
    translation: zhCN
  }
}

const lazyLoaders: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  'zh-TW': () => import('../renderer/src/locales/zh-TW.json'),
  'ru-RU': () => import('../renderer/src/locales/ru-RU.json'),
  'fa-IR': () => import('../renderer/src/locales/fa-IR.json')
}

export const supportedLanguages = [...Object.keys(resources), ...Object.keys(lazyLoaders)]

const loadedLazyLanguages = new Set<string>()

async function ensureLanguage(lng: string): Promise<void> {
  const loader = lazyLoaders[lng]
  if (!loader || loadedLazyLanguages.has(lng)) return
  const resource = await loader()
  i18next.addResourceBundle(lng, 'translation', resource.default, true, true)
  loadedLazyLanguages.add(lng)
}

export const defaultConfig = {
  resources,
  lng: 'zh-CN',
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false
  }
}

export const initI18n = async (options: { lng?: string } = {}): Promise<typeof i18next> => {
  if (options.lng) {
    await ensureLanguage(options.lng)
  }
  await i18next.init({
    ...defaultConfig,
    ...options
  })
  return i18next
}

// Load the bundle before switching, so the first render after a language change
// is already translated rather than falling back to raw keys.
export const changeLanguage = async (lng: string): Promise<void> => {
  await ensureLanguage(lng)
  await i18next.changeLanguage(lng)
}

export default i18next
