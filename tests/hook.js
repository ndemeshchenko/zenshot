function testHook(ed) {
    if (globalThis.zenshotTested) // the reload test below re-runs start()
        return;
    globalThis.zenshotTested = true;
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 6, () => {
        (async () => {
            const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
            const seat = Clutter.get_default_backend().get_default_seat();
            const ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            const kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const now = () => GLib.get_monotonic_time();
            const move = async (x, y) => { ptr.notify_absolute_motion(now(), x, y); await sleep(60); };
            const down = async () => { ptr.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED); await sleep(60); };
            const up = async () => { ptr.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED); await sleep(60); };
            const drag = async (x1, y1, x2, y2) => { await move(x1, y1); await move(x1, y1); await down(); await move((x1 + x2) / 2, (y1 + y2) / 2); await move(x2, y2); await up(); };
            const key = async (sym, ctrl = false) => {
                if (ctrl) kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
                kbd.notify_keyval(now(), sym, Clutter.KeyState.PRESSED);
                await sleep(30);
                kbd.notify_keyval(now(), sym, Clutter.KeyState.RELEASED);
                if (ctrl) kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
                await sleep(80);
            };
            const centre = b => { const [x, y] = b.get_transformed_position(); const [w, h] = b.get_transformed_size(); return [x + w / 2, y + h / 2]; };
            const T = (n, v) => console.log('T: ' + n + ' = ' + JSON.stringify(v));
            const run = (...argv) => new Promise(r => Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE).wait_check_async(null, (p, res) => r(p.wait_check_finish(res))));
            try {
                // run 1: full flow ending in Ctrl+C
                await move(1, 1);
                await ed.start(); await sleep(300);
                T('active after start', ed.active); T('modalCount', Main.modalCount);
                await drag(200, 150, 800, 450); await sleep(300);
                T('phase', ed._phase); T('sel', ed._sel);
                const shot = async path => {
                    const [c, sc] = await new Shell.Screenshot().screenshot_stage_to_content();
                    const f = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
                    await Shell.Screenshot.composite_to_stream(c.get_texture(), 0, 0, -1, -1, sc, null, 0, 0, 1, f);
                    f.close(null);
                };
                const ui = GLib.getenv('ZENSHOT_TEST_UI');
                const [bx, by] = centre(ed._toolBtns.line); await move(bx, by); await sleep(300);
                T('tooltip on hover', !!ed._tip);
                if (ui) await shot(ui + '-tip.png');
                await down(); await up();
                T('tooltip gone after click', !ed._tip);
                T('default colour', ed._color);
                const [cx, cy] = centre(ed._colorBtn); await move(cx, cy); await down(); await up(); await sleep(200);
                T('palette open', !!ed._palette);
                if (ui) await shot(ui + '-palette.png');
                const [px, py] = centre(ed._swatches[5]); await move(px, py); await down(); await up(); await sleep(200);
                T('colour after pick', ed._color); T('palette closed', !ed._palette);
                T('anns after palette clicks', ed._anns.length);
                await move(cx, cy); await down(); await up(); await sleep(150);
                await key(Clutter.KEY_Escape);
                T('esc closes palette only', [ed.active, !!ed._palette]);
                T('tool after click Line', ed._tool);
                await drag(250, 200, 600, 260);
                T('anns after line', ed._anns.length);
                const [rx, ry] = centre(ed._toolBtns.blur); await move(rx, ry); await down(); await up();
                await drag(300, 300, 500, 400);
                T('anns after blur', ed._anns.length);
                const [tx, ty] = centre(ed._toolBtns.text); await move(tx, ty); await down(); await up();
                await move(300, 180); await down(); await up(); await sleep(200);
                T('entry open', !!ed._entry);
                await key(Clutter.KEY_h); await key(Clutter.KEY_i); await key(Clutter.KEY_Return);
                T('anns after text', ed._anns.map(a => a.type + (a.text ? ':' + a.text : '')));
                await key(Clutter.KEY_z, true);
                T('anns after ctrl+z', ed._anns.length);
                const out = GLib.getenv('ZENSHOT_TEST_OUT');
                if (out)
                    GLib.file_set_contents(out, ed._renderPng().get_data());
                await key(Clutter.KEY_c, true); await sleep(300);
                T('active after ctrl+c', ed.active); T('modalCount after', Main.modalCount);
                await new Promise(r => St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, 'image/png', (c, b) => { T('clipboard bytes', b ? b.get_size() : null); r(); }));

                // run 2: Escape in selection phase, then Escape in edit phase
                await ed.start(); await sleep(300);
                await key(Clutter.KEY_Escape); await sleep(200);
                T('active after esc (select)', ed.active); T('modalCount', Main.modalCount);
                await ed.start(); await sleep(300);
                await drag(200, 150, 800, 450); await sleep(300);
                await key(Clutter.KEY_Escape); await sleep(200);
                T('active after esc (edit)', ed.active); T('modalCount', Main.modalCount);
                // run 3: Escape while text entry open should only close the entry
                await ed.start(); await sleep(300);
                await drag(200, 150, 800, 450); await sleep(300);
                const [t2x, t2y] = centre(ed._toolBtns.text); await move(t2x, t2y); await down(); await up();
                await move(300, 180); await down(); await up(); await sleep(200);
                await key(Clutter.KEY_Escape);
                T('after esc w/ entry: active,entry', [ed.active, !!ed._entry]);
                await key(Clutter.KEY_Escape);
                T('after 2nd esc active', ed.active); T('modalCount', Main.modalCount);
                // mixed scales: Meta-0 at 1, Meta-1 (1920x1080) at 2, in both layout modes
                const views = () => [Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height, m.geometry_scale]), global.stage.peek_stage_views().map(v => v.get_scale())];
                const layout = async mode => { await run('/usr/bin/python3', '/usr/bin/gdctl', 'set', '-l', mode, '-L', '-M', 'Meta-0', '-p', '-L', '-M', 'Meta-1', '-s', '2', '--right-of', 'Meta-0'); await sleep(1000); T('views ' + mode, views()); };
                const crop = async (x, y, w, h) => { await ed.start(); await sleep(300); ed._sel = {x, y, w, h}; await ed._enterEdit(); const r = [ed._base.getWidth(), ed._base.getHeight()]; await key(Clutter.KEY_Escape); await sleep(200); return r; };
                await layout('physical');
                T('crop scale 2, physical', await crop(1700, 50, 200, 200));
                await layout('logical');
                T('crop scale 2, logical', await crop(1700, 50, 200, 200));
                T('crop across monitors, logical', await crop(1500, 100, 200, 100));
                T('crop scale 1, logical', await crop(200, 150, 600, 300));
                console.log('zenshot-test: DONE');
            } catch (e) {
                logError(e, 'zenshot-test failed');
            }
            ed.close();

            // live reload: change the installed code, then disable + enable with the CLI, as `make install` does
            try {
                const uuid = 'zenshot@local';
                const js = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', uuid, 'extension.js']));
                const src = new TextDecoder().decode(js.load_contents(null)[1]);
                js.replace_contents(new TextEncoder().encode(src + "\nconsole.log('T: reloaded code ran');\n"), null, false, Gio.FileCreateFlags.NONE, null);
                T('cli disable/enable', [await run('gnome-extensions', 'disable', uuid), await run('gnome-extensions', 'enable', uuid)]);
                await sleep(1000);
                const ext = Main.extensionManager.lookup(uuid);
                T('state after reload', [ext.state, ext.stateObj._stop !== null]);
            } catch (e) {
                logError(e, 'zenshot-test reload failed');
            }
        })();
        return GLib.SOURCE_REMOVE;
    });
}
