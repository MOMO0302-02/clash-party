#!/usr/bin/env bash
# Runs on GitHub Actions `ubuntu-latest`, from the repo root, after:
#   corepack pnpm install
#   node node_modules/electron/install.js      # if install scripts were skipped
# Copy this directory into the checkout (e.g. ./ci-probes) before running.
set -uo pipefail

PROBES="${PROBES:-./ci-probes}"
ELECTRON="./node_modules/.bin/electron"

sudo apt-get update -qq
sudo apt-get install -y -qq \
  xvfb dbus-x11 python3-dbus python3-gi gir1.2-glib-2.0 \
  imagemagick binutils file

##############################################################################
echo "### A. glibc floor of the shipped binaries  (issue #530)"
##############################################################################
# Requires a prior `pnpm run build:linux`; run this block against dist/.
if [ -d dist/linux-unpacked ]; then
  find dist/linux-unpacked -type f \( -name '*.so*' -o -perm -u+x \) -print0 |
    xargs -0 -n1 objdump -T 2>/dev/null |
    grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -5
  echo "--- declared deb dependencies ---"
  dpkg-deb -f dist/clash-party-linux-*-amd64.deb Depends
else
  echo "SKIP: no dist/linux-unpacked (run pnpm run build:linux first)"
fi

##############################################################################
echo "### B. StatusNotifierItem registration  (issues #2083 #2099 #1538)"
##############################################################################
run_tray_case() {
  local label="$1" resize="$2"
  echo "--- case: $label ---"
  dbus-run-session -- bash -c "
    xvfb-run -a --server-args='-screen 0 1280x800x24' bash -c '
      python3 \"$PROBES/sni-watcher.py\" & WATCHER=\$!
      sleep 2
      $ELECTRON \"$PROBES/tray-probe.cjs\" resources/icon.png $resize 15000 &
      TRAY=\$!
      sleep 6
      echo \"--- names on the session bus ---\"
      busctl --user list --no-pager | grep -i -E \"statusnotifier|electron\" || true
      SNI=\$(busctl --user list --no-pager | awk \"/StatusNotifierItem/{print \\\$1; exit}\")
      echo \"SNI name: \${SNI:-none}\"
      if [ -n \"\${SNI:-}\" ]; then
        echo \"--- introspect /StatusNotifierItem ---\"
        gdbus introspect --session --dest \"\$SNI\" --object-path /StatusNotifierItem || true
        echo \"--- GetAll org.kde.StatusNotifierItem ---\"
        gdbus call --session --dest \"\$SNI\" --object-path /StatusNotifierItem \
          --method org.freedesktop.DBus.Properties.GetAll org.kde.StatusNotifierItem \
          2>&1 | head -c 2000 || true
        echo
      fi
      wait \$TRAY; kill \$WATCHER 2>/dev/null
    '
  "
}
# Expected failure signature from electron/electron#52674:
#   the SNI bus name exists but /StatusNotifierItem introspects as an empty node
#   (no interfaces) and GetAll fails / returns nothing.
run_tray_case "512x512 icon, exactly what clash-party ships" 0
run_tray_case "icon downscaled to 22px" 22

##############################################################################
echo "### C. frameless-window border  (issue #2105)"
##############################################################################
for variant in "default" "noshadow"; do
  for gtk in "Adwaita" "Adwaita:dark"; do
    out="border-${variant}-${gtk//:/-}.png"
    GTK_THEME="$gtk" xvfb-run -a --server-args='-screen 0 1280x800x24' \
      "$ELECTRON" "$PROBES/border-probe.cjs" "$out" "$variant" dark
    # Sample a pixel 1px outside the client area at mid-height of the window.
    echo -n "$out edge pixel: "
    convert "$out" -format '%[pixel:p{240,400}]' info: 2>/dev/null; echo
  done
done

##############################################################################
echo "### D. does the packaged deb start on Ubuntu 22.04?  (issue #739)"
##############################################################################
# Throwaway container: the app will start a core and touch proxy settings, which
# is fine here but must never be run on a developer machine.
if [ -f dist/clash-party-linux-*-amd64.deb ]; then
  docker run --rm -v "$PWD/dist:/dist:ro" ubuntu:22.04 bash -c '
    apt-get update -qq
    apt-get install -y -qq xvfb /dist/clash-party-linux-*-amd64.deb 2>&1 | tail -20
    timeout 60 xvfb-run -a /opt/clash-party/mihomo-party --no-sandbox 2>&1 | head -40
    echo "exit=$?"
  '
fi
