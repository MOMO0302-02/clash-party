import { describe, expect, it } from 'vitest'
import { quoteDesktopExecArg } from './desktopExec'

describe('quoteDesktopExecArg', () => {
  it('quotes paths with spaces without changing the executable argument', () => {
    expect(quoteDesktopExecArg('/opt/Clash Party/mihomo-party')).toBe(
      '"/opt/Clash Party/mihomo-party"'
    )
    expect(quoteDesktopExecArg('/opt/mihomo-party')).toBe('"/opt/mihomo-party"')
  })

  it('escapes Desktop Entry metacharacters inside the quoted argument', () => {
    expect(quoteDesktopExecArg('/tmp/a\\b"c`d$e%f')).toBe('"/tmp/a\\\\b\\"c\\`d\\$e%%f"')
  })
})
