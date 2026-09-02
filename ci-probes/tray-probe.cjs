// Reproduces exactly what src/main/resolve/tray.ts does on Linux:
//   tray = new Tray(pngIcon)   // pngIcon = resources/icon.png, 512x512
// and optionally the same thing with a downscaled icon, so we can tell whether
// the icon size is what breaks the StatusNotifierItem.
//
// Usage: electron tray-probe.cjs <icon-path> [resize-height] [alive-ms]
// Prints TRAY_CREATED / TRAY_ALIVE so an outer script can sequence DBus probing.

const { app, Tray, nativeImage } = require('electron')

const iconPath = process.argv[2]
const resizeHeight = parseInt(process.argv[3] || '0', 10)
const aliveMs = parseInt(process.argv[4] || '20000', 10)

app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(() => {
  let image = iconPath
  if (resizeHeight > 0) {
    image = nativeImage.createFromPath(iconPath).resize({ height: resizeHeight })
    console.log(`RESIZED to ${resizeHeight}px empty=${image.isEmpty()}`)
  } else {
    const probe = nativeImage.createFromPath(iconPath)
    console.log(`RAW size=${JSON.stringify(probe.getSize())} empty=${probe.isEmpty()}`)
  }

  const tray = new Tray(image)
  tray.setToolTip('clash-party tray probe')
  console.log(`TRAY_CREATED pid=${process.pid}`)

  setTimeout(() => {
    console.log('TRAY_ALIVE')
    tray.destroy()
    app.quit()
  }, aliveMs)
})
