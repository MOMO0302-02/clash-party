import { describe, it, expect } from 'vitest'
import i18next from 'i18next'
import { initI18n, changeLanguage, supportedLanguages } from './i18n'

// Regression guard: addResourceBundle is only bound onto the i18next instance
// after init(), so loading a lazy locale before initialisation throws.
describe('i18n lazy locale loading', () => {
  it('initialises directly into a lazily-loaded language', async () => {
    await initI18n({ lng: 'zh-TW' })
    expect(i18next.isInitialized).toBe(true)
    expect(i18next.language).toBe('zh-TW')
    expect(i18next.t('settings.language')).not.toBe('settings.language')
  })

  it('switches to another lazily-loaded language', async () => {
    await changeLanguage('ru-RU')
    expect(i18next.language).toBe('ru-RU')
    expect(i18next.t('settings.language')).not.toBe('settings.language')
  })

  it('switches back to a bundled language', async () => {
    await changeLanguage('zh-CN')
    expect(i18next.language).toBe('zh-CN')
    expect(i18next.t('settings.language')).not.toBe('settings.language')
  })

  it('resolves every supported language', async () => {
    for (const lng of supportedLanguages) {
      await changeLanguage(lng)
      expect(i18next.t('settings.language'), `${lng} failed`).not.toBe('settings.language')
    }
  })
})
