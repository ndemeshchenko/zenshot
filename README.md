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

- Area selection on a frozen screen, across multiple monitors, each captured at its own scale
- Window capture: the window under the pointer is highlighted, click to select it
- Tools: **Line, Arrow, Rect, Area** (filled highlight), **Blur** (mosaic), **Pen, Text**
- Icon toolbar with tooltips, a 12-colour palette popup (red by default), three sizes, undo
- Copy to clipboard (PNG), or save to `~/Pictures/Screenshots`, with a notification

## Keys

| Key | Action |
|---|---|
| Super+Shift+A | Start a capture (configurable) |
| Click (no drag) | Select the highlighted window |
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
```

The first time, log out and back in once: on Wayland the shell only discovers new extensions at login.
`make install` already adds it to your enabled extensions. After that, running `make install` again
upgrades it in place, with no re-login.

`make pack` builds an installable zip with `gnome-extensions pack`.

## Limitations

- Tested only on GNOME 50.1. It uses internal Shell APIs, so expect small fixes after major GNOME releases.
- No moving or resizing the selection after you drag it, and no magnifier yet.
- Window capture takes what is visible in the window's frame, so anything on top of it is included, and it is off while the Activities overview is open.
- Over remote desktops such as NoMachine, the image clipboard may not sync to the client. Paste on the machine itself to check.
- Extensions run inside the shell with full access to the session. Read the code before you install it, it's one file.

## Development

`make test` runs the extension in a throwaway headless GNOME Shell, with its own D-Bus session and private
settings, and drives it with virtual pointer and keyboard devices: select, draw, type text, undo, copy and Esc
paths. It does not touch your session. It needs `gnome-shell` and `dbus-run-session`. `tests/last-render.png`
is the rendered output of the last run.

The shell caches extension code by file path, so `enable()` re-imports `extension.js` through a symlink in
`$XDG_RUNTIME_DIR/zenshot/` named after the file's mtime. That is what lets `make install` reload it live.
Changes to the `Zenshot` class itself or to `metadata.json` still need a re-login.

## License

MIT
