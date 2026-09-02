#!/usr/bin/env python3
"""Minimal org.kde.StatusNotifierWatcher stub.

Chromium's StatusIconLinuxDbus only exports its StatusNotifierItem object when a
watcher is present on the session bus, so a headless CI runner needs this stub
before an Electron tray can be observed at all.

Prints one line per registration:  REGISTERED <bus name or unique name>

Requires: python3-dbus python3-gi
Run inside `dbus-run-session`.
"""

import sys

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

WATCHER_IFACE = "org.kde.StatusNotifierWatcher"
PROPS_IFACE = "org.freedesktop.DBus.Properties"


class Watcher(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/StatusNotifierWatcher")
        self.items = []

    @dbus.service.method(WATCHER_IFACE, in_signature="s", sender_keyword="sender")
    def RegisterStatusNotifierItem(self, service, sender=None):
        print("REGISTERED service=%s sender=%s" % (service, sender), flush=True)
        self.items.append(service if service.startswith(":") else sender)
        self.StatusNotifierItemRegistered(service)

    @dbus.service.method(WATCHER_IFACE, in_signature="s")
    def RegisterStatusNotifierHost(self, service):
        print("HOST_REGISTERED %s" % service, flush=True)

    @dbus.service.signal(WATCHER_IFACE, signature="s")
    def StatusNotifierItemRegistered(self, service):
        pass

    @dbus.service.signal(WATCHER_IFACE, signature="")
    def StatusNotifierHostRegistered(self):
        pass

    def _props(self):
        return {
            "IsStatusNotifierHostRegistered": dbus.Boolean(True),
            "ProtocolVersion": dbus.Int32(0),
            "RegisteredStatusNotifierItems": dbus.Array(self.items, signature="s"),
        }

    @dbus.service.method(PROPS_IFACE, in_signature="ss", out_signature="v")
    def Get(self, iface, prop):
        return self._props()[prop]

    @dbus.service.method(PROPS_IFACE, in_signature="s", out_signature="a{sv}")
    def GetAll(self, iface):
        return self._props()


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    name = dbus.service.BusName(WATCHER_IFACE, bus, do_not_queue=True)
    watcher = Watcher(bus)
    print("WATCHER_READY %s" % name.get_name(), flush=True)
    watcher.StatusNotifierHostRegistered()
    GLib.MainLoop().run()


if __name__ == "__main__":
    sys.exit(main())
