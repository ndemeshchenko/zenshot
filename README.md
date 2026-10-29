# Zenshot

An instant screenshot-and-annotate tool for **GNOME Shell on Wayland**, in the spirit of Flameshot.

Press a shortcut, drag an area, mark it up, copy it. The screen freezes immediately, with none of the
multi-second delay that Flameshot and other screenshot apps hit on Wayland.

## Why an extension?

On Wayland a normal app cannot read the screen. It has to ask the screenshot portal, and GNOME Shell then
PNG-encodes the **whole desktop** before handing it over. On a large multi-monitor setup that takes seconds
(about 3.3 s for 9600×3240 on the machine this was written on).

Zenshot runs inside GNOME Shell, so it freezes the stage straight from GPU memory (a few ms), and it
only encodes the small area you select.

## Features

- Area selection on a frozen screen, across multiple monitors
- Tools: **Line, Arrow, Rect, Area** (filled highlight), **Blur** (mosaic), **Pen, Text**
- Six colours, three sizes, undo
- Copy to clipboard (PNG), or save to `~/Pictures/Screenshots`, with a notification

## Keys

| Key | Action |
|---|---|
| Super+Shift+A | Start a capture (configurable) |
| Enter / Ctrl+C | Copy and close |
| Ctrl+S | Save and copy |
| Ctrl+Z | Undo |
| Esc | Cancel (closes an open text box first) |

Change the shortcut:

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/zenshot@local/schemas \
  set org.gnome.shell.extensions.zenshot trigger "['<Super><Shift>s']"
```

## Install

Requires GNOME Shell **50** (the only version it has been tested on).

```sh
make install
# log out and back in (Wayland only discovers new extensions at login), then:
gnome-extensions enable zenshot@local
```

`make pack` builds an installable zip with `gnome-extensions pack`.

## Limitations

- Tested only on GNOME 50.1. It uses internal Shell APIs, so expect small fixes after major GNOME releases.
- No moving or resizing the selection after you drag it, and no magnifier yet.
- Over remote desktops such as NoMachine, the image clipboard may not sync to the client. Paste on the machine itself to check.
- Extensions run inside the shell with full access to the session. Read the code before you install it, it's one file.

## Development

`make test` runs the extension in a throwaway headless GNOME Shell, with its own D-Bus session and private
settings, and drives it with virtual pointer and keyboard devices: select, draw, type text, undo, copy and Esc
paths. It does not touch your session. It needs `gnome-shell` and `dbus-run-session`. `tests/last-render.png`
is the rendered output of the last run.

On GNOME 45+ the shell caches extension code, so changes to `extension.js` need a re-login to load.

## License

MIT
