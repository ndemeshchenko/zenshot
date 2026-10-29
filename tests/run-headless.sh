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
sed -i 's|this._settings = this.getSettings();|this._settings = this.getSettings(); testHook(this._editor);|' "$ext/extension.js"
cat "$here/tests/hook.js" >> "$ext/extension.js"
printf "[org/gnome/shell]\nenabled-extensions=['%s']\ndisable-user-extensions=false\n" "$uuid" \
    > "$work/config/glib-2.0/settings/keyfile"
out=${ZENSHOT_TEST_OUT:-$here/tests/last-render.png}
env -i PATH="$PATH" HOME="$work" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$work/config" \
    XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" XDG_RUNTIME_DIR="$work/run" \
    ZENSHOT_TEST_OUT="$out" \
    timeout 60 dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --virtual-monitor 1600x900 > "$work/shell.log" 2>&1 || true
grep -E "zenshot|T: |CRITICAL|JS ERROR" "$work/shell.log" | sed 's/.*Message: [0-9:.]* //'
check() { grep -q "$1" "$work/shell.log" && echo "PASS  $2" || { echo "FAIL  $2"; fail=1; }; }
fail=0
check 'T: phase = "edit"' "selection enters edit phase"
check 'anns after text = \["line","blur","text:hi"\]' "line, blur and text annotations"
check 'T: anns after ctrl+z = 2' "undo"
check 'T: active after ctrl+c = false' "ctrl+c closes the editor"
check 'T: clipboard bytes = ' "clipboard receives a PNG"
check 'T: active after esc (select) = false' "esc cancels while selecting"
check 'T: active after esc (edit) = false' "esc cancels while editing"
check 'after esc w/ entry: active,entry = \[true,false\]' "esc closes the text box only"
check 'T: after 2nd esc active = false' "second esc closes the editor"
if grep -qE "CRITICAL|JS ERROR" "$work/shell.log"; then echo "FAIL  errors in shell log"; fail=1; fi
exit $fail
