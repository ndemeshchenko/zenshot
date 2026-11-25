#!/bin/bash
# Runs the extension in a throwaway headless GNOME Shell (own D-Bus session, private
# settings) and drives it with virtual pointer/keyboard devices. Does not touch your session.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
uuid=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$here/metadata.json")
ext=$work/data/gnome-shell/extensions/$uuid
mkdir -p "$ext" "$work/config/glib-2.0/settings" "$work/cache" "$work/run"
chmod 700 "$work/run"
cp -r "$here/extension.js" "$here/metadata.json" "$here/schemas" "$ext/"
glib-compile-schemas "$ext/schemas"
sed -i 's|const settings = ext.getSettings();|& testHook(editor);|' "$ext/extension.js"
cat "$here/tests/hook.js" >> "$ext/extension.js"
printf "[org/gnome/shell]\nenabled-extensions=['%s']\ndisable-user-extensions=false\n" "$uuid" \
    > "$work/config/glib-2.0/settings/keyfile"
out=${ZENSHOT_TEST_OUT:-$here/tests/last-render.png}
env -i PATH="$PATH" HOME="$work" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$work/config" \
    XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" XDG_RUNTIME_DIR="$work/run" \
    ZENSHOT_TEST_OUT="$out" ZENSHOT_TEST_UI="${ZENSHOT_TEST_UI:-}" \
    timeout 60 dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --virtual-monitor 1600x900 --virtual-monitor 1920x1080 > "$work/shell.log" 2>&1 || true
grep -E "zenshot|T: |CRITICAL|JS ERROR" "$work/shell.log" | sed 's/.*Message: [0-9:.]* //'
check() { grep -q "$1" "$work/shell.log" && echo "PASS  $2" || { echo "FAIL  $2"; fail=1; }; }
fail=0
check 'T: crop scale 1, logical = \[600,300\]' "scale-1 monitor next to a scale-2 one captures at 1x"
check 'T: crop scale 2, logical = \[400,400\]' "scale-2 monitor captures at 2x (logical layout)"
check 'T: crop across monitors, logical = \[400,200\]' "selection across monitors uses the highest scale"
check 'T: crop scale 2, physical = \[200,200\]' "scale-2 monitor captures 1:1 (physical layout)"
check 'T: phase = "edit"' "selection enters edit phase"
check 'T: click selects window under pointer = \["edit",true\]' "click without dragging selects the window"
check 'T: click on overlap selects top window = \["edit",true\]' "overlapping windows: the top one wins"
check 'T: hover highlights window = true' "hovering highlights the window"
check 'T: overview open, windows offered = \[true,0\]' "no window capture while the overview is open"
check 'T: thin drag over window selects nothing = \["select",null\]' "a thin drag is not a click"
check 'T: hover outline inside the window = true' "hover outline is inside the window (visible when fullscreen)"
check 'T: double click: one editor = \[true,"edit",1\]' "double click opens one editor"
check 'T: window clipped to its monitor = \[true,true\]' "window rect is clipped to the monitors"
check 'T: drag over window selects area = \["edit",{"x":150,"y":150,"w":100,"h":70}\]' "dragging over a window still selects an area"
check 'T: resize corner = \["edit",{"x":200,"y":150,"w":500,"h":350},500,350\]' "dragging a corner resizes and re-crops"
check 'T: resize edge = \[{"x":100,"y":150,"w":600,"h":350},\[\[200,50,300,100\]\]\]' "dragging an edge resizes; annotations stay put"
check 'T: tooltip on hover = true' "tooltip shows on hover"
check 'T: tooltip gone after click = true' "tooltip hides on click"
check 'T: default colour = 0' "default colour is the first (red)"
check 'T: palette open = true' "colour button opens the palette"
check 'T: colour after pick = 5' "picking a swatch changes the colour"
check 'T: palette closed = true' "palette closes after picking"
check 'T: anns after palette clicks = 0' "palette clicks do not draw"
check 'T: esc closes palette only = \[true,false\]' "esc closes the palette before the editor"
check 'anns after text = \["line","blur","text:hi"\]' "line, blur and text annotations"
check 'T: anns after ctrl+z = 2' "undo"
check 'T: active after ctrl+c = false' "ctrl+c closes the editor"
check 'T: clipboard bytes = ' "clipboard receives a PNG"
check 'T: active after esc (select) = false' "esc cancels while selecting"
check 'T: active after esc (edit) = false' "esc cancels while editing"
check 'after esc w/ entry: active,entry = \[true,false\]' "esc closes the text box only"
check 'T: after 2nd esc active = false' "second esc closes the editor"
check 'T: reloaded code ran' "make install path runs new code without re-login"
check 'T: state after reload = \[1,true\]' "extension active after reload"
if grep -qE "CRITICAL|JS ERROR" "$work/shell.log"; then echo "FAIL  errors in shell log"; fail=1; fi
exit $fail
