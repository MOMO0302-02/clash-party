// Reproduces src/main/window.ts BrowserWindow options on Linux (frameless +
// titleBarStyle 'hidden' + titleBarOverlay), then screenshots itself so we can
// look at the window edge. Pass hasShadow=false to test the documented escape
// hatch for GTK client-side decorations.
//
// Usage: electron border-probe.cjs <out.png> [noshadow] [dark|light]

const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('fs')

const outPath = process.argv[2] || 'border.png'
const noShadow = process.argv[3] === 'noshadow'
const theme = process.argv[4] === 'light' ? 'light' : 'dark'

app.commandLine.appendSwitch('no-sandbox')

const html = `data:text/html,${encodeURIComponent(
  '<html><body style="margin:0;background:#101014;color:#eee;font:16px sans-serif">' +
    '<div style="padding:24px">clash-party border probe</div></body></html>'
)}`

app.whenReady().then(async () => {
  nativeTheme.themeSource = theme

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    fullscreenable: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 47, color: '#101014', symbolColor: '#eeeeee' },
    autoHideMenuBar: true,
    ...(noShadow ? { hasShadow: false } : {}),
    webPreferences: { sandbox: false }
  })

  await win.loadURL(html)
  win.show()
  await new Promise((r) => setTimeout(r, 2000))

  // capturePage() only covers the web contents; grab the whole screen instead so
  // the decoration drawn outside the client area is included.
  const { desktopCapturer, screen } = require('electron')
  const { width, height } = screen.getPrimaryDisplay().size
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  fs.writeFileSync(outPath, sources[0].thumbnail.toPNG())
  console.log(`SCREENSHOT ${outPath} noShadow=${noShadow} theme=${theme}`)
  app.quit()
})
