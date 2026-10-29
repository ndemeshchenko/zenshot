function testHook(ed) {
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
            const drag = async (x1, y1, x2, y2) => { await move(x1, y1); await down(); await move((x1 + x2) / 2, (y1 + y2) / 2); await move(x2, y2); await up(); };
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
            try {
                // run 1: full flow ending in Ctrl+C
                await move(1, 1);
                await ed.start(); await sleep(300);
                T('active after start', ed.active); T('modalCount', Main.modalCount);
                await drag(200, 150, 800, 450); await sleep(300);
                T('phase', ed._phase); T('sel', ed._sel);
                const [bx, by] = centre(ed._toolBtns.line); await move(bx, by); await down(); await up();
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
                console.log('zenshot-test: DONE');
            } catch (e) {
                logError(e, 'zenshot-test failed');
            }
            ed.close();
        })();
        return GLib.SOURCE_REMOVE;
    });
}
