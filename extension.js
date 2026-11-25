import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLORS = [
    '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5',
    '#8e24aa', '#ec407a', '#ffffff', '#9e9e9e', '#6d4c41', '#000000',
];
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const WIDTHS = [['S', 2], ['M', 4], ['L', 8]];
const TOOLS = [
    ['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rectangle'], ['area', 'Highlight area'],
    ['blur', 'Blur'], ['pen', 'Pen'], ['text', 'Text'],
];
const BLUR_BLOCK = 8; // logical px per mosaic block
const MIN_SELECTION = 6;

const BTN_STYLE = 'padding: 6px; border-radius: 6px;';
const BTN_ACTIVE = `${BTN_STYLE} background-color: #3584e4;`;
const TXT_STYLE = 'color: white; padding: 4px 9px; border-radius: 6px; font-weight: bold;';
const TXT_ACTIVE = `${TXT_STYLE} background-color: #3584e4;`;
const ICON_SIZE = 20;

const circleStyle = (css, ring) =>
    `background-color: ${css}; width: 18px; height: 18px; border-radius: 11px; border: 2px solid ${ring}; margin: 2px; padding: 0;`;

function arrowHead(cr, x1, y1, x2, y2, head) {
    const ang = Math.atan2(y2 - y1, x2 - x1), spread = Math.PI / 7;
    cr.moveTo(x2, y2);
    cr.lineTo(x2 - head * Math.cos(ang - spread), y2 - head * Math.sin(ang - spread));
    cr.lineTo(x2 - head * Math.cos(ang + spread), y2 - head * Math.sin(ang + spread));
    cr.closePath();
    cr.fill();
}

// Tool icons are drawn with Cairo on a 20x20 grid: the icon theme has no line/arrow/blur glyphs.
const ICONS = {
    line: cr => {
        cr.moveTo(3.5, 16.5);
        cr.lineTo(16.5, 3.5);
        cr.stroke();
    },
    arrow: cr => {
        cr.moveTo(3.5, 16.5);
        cr.lineTo(13.5, 6.5);
        cr.stroke();
        arrowHead(cr, 3.5, 16.5, 16.5, 3.5, 8);
    },
    rect: cr => {
        cr.rectangle(3.5, 5.5, 13, 9);
        cr.stroke();
    },
    area: cr => {
        cr.setSourceRGBA(1, 1, 1, 0.3);
        cr.rectangle(3.5, 5.5, 13, 9);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.stroke();
    },
    blur: cr => {
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                cr.setSourceRGBA(1, 1, 1, (i + j) % 2 ? 0.35 : 0.95);
                cr.rectangle(3 + i * 5, 3 + j * 5, 4, 4);
                cr.fill();
            }
        }
    },
    pen: cr => {
        cr.moveTo(3, 14);
        cr.curveTo(6, 3, 9, 3, 10, 10);
        cr.curveTo(11, 17, 14, 17, 17, 6);
        cr.stroke();
    },
    text: cr => {
        cr.setLineWidth(2.2);
        cr.moveTo(4, 5);
        cr.lineTo(16, 5);
        cr.moveTo(10, 5);
        cr.lineTo(10, 16);
        cr.stroke();
    },
};

function makeIcon(id) {
    const area = new St.DrawingArea({width: ICON_SIZE, height: ICON_SIZE});
    area.connect('repaint', () => {
        const cr = area.get_context();
        try {
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.setLineWidth(1.8);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            ICONS[id](cr);
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

const themeIcon = name => new St.Icon({icon_name: name, icon_size: 16, style: 'color: white;'});

class Editor {
    constructor() {
        this._root = null;
        this._active = false;
    }

    get active() {
        return this._active;
    }

    async start() {
        if (this._active)
            return;
        this._active = true;
        const t0 = GLib.get_monotonic_time();
        try {
            // Paint each stage view (monitor) at its own scale. The shell's full-stage capture uses
            // the highest scale everywhere, which upscales and blurs monitors with a lower one.
            this._views = global.stage.peek_stage_views().map(v => {
                const r = new Mtk.Rectangle();
                v.get_layout(r);
                const s = v.get_scale();
                return {x: r.x, y: r.y, w: r.width, h: r.height, s,
                    content: global.stage.paint_to_content(r, s, null, Clutter.PaintFlag.NO_CURSORS)};
            });
            console.log(`zenshot: capture ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(0)} ms`);
            this._build();
        } catch (e) {
            logError(e, 'zenshot: start failed');
            this.close();
        }
    }

    _build() {
        const W = global.stage.width, H = global.stage.height;
        this._W = W;
        this._H = H;

        this._root = new St.Widget({
            reactive: true, can_focus: true, x: 0, y: 0, width: W, height: H,
            layout_manager: new Clutter.FixedLayout(),
        });
        for (const v of this._views) {
            const shot = new St.Widget({x: v.x, y: v.y, width: v.w, height: v.h});
            shot.set_content_gravity(Clutter.ContentGravity.RESIZE_FILL);
            shot.set_content(v.content);
            this._root.add_child(shot);
        }

        this._dim = [];
        for (let i = 0; i < 4; i++) {
            const d = new St.Widget({style: 'background-color: rgba(0,0,0,0.55);'});
            this._dim.push(d);
            this._root.add_child(d);
        }
        this._border = new St.Widget({style: 'border: 1px solid #3584e4;'});
        this._root.add_child(this._border);

        this._phase = 'select';
        this._sel = null;
        this._anns = [];
        this._cur = null;
        this._tool = 'arrow';
        this._color = 0;
        this._width = 1;
        this._layoutDim();

        this._root.connect('button-press-event', (a, ev) => this._guard(() => this._press(ev)));
        this._root.connect('motion-event', (a, ev) => this._guard(() => this._motion(ev)));
        this._root.connect('button-release-event', (a, ev) => this._guard(() => this._release(ev)));
        this._root.connect('key-press-event', (a, ev) => this._guard(() => this._key(ev)));

        Main.layoutManager.uiGroup.add_child(this._root);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._root, null);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab) {
            this.close();
            return;
        }
        this._root.grab_key_focus();
        this._setCursor(Clutter.CursorType.CROSSHAIR);
    }

    // Any exception in an input handler must not leave the compositor grabbed.
    _guard(fn) {
        try {
            return fn();
        } catch (e) {
            logError(e, 'zenshot: handler failed');
            this.close();
            return Clutter.EVENT_STOP;
        }
    }

    _setCursor(type) {
        this._root?.set_cursor_type(type);
    }

    _layoutDim() {
        const s = this._sel ?? {x: 0, y: 0, w: 0, h: 0};
        const W = this._W, H = this._H;
        const rects = [
            [0, 0, W, s.y],
            [0, s.y + s.h, W, H - s.y - s.h],
            [0, s.y, s.x, s.h],
            [s.x + s.w, s.y, W - s.x - s.w, s.h],
        ];
        this._dim.forEach((d, i) => {
            const [x, y, w, h] = rects[i];
            d.set_position(x, y);
            d.set_size(Math.max(0, w), Math.max(0, h));
        });
        this._border.visible = !!this._sel;
        if (this._sel) {
            this._border.set_position(s.x - 1, s.y - 1);
            this._border.set_size(s.w + 2, s.h + 2);
        }
    }

    _inSel(x, y) {
        const s = this._sel;
        return s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
    }

    _overUI(ev) {
        const [x, y] = ev.get_coords();
        return [this._toolbar, this._palette].some(w => {
            if (!w)
                return false;
            const [wx, wy] = w.get_transformed_position();
            const [ww, wh] = w.get_transformed_size();
            return x >= wx && y >= wy && x < wx + ww && y < wy + wh;
        });
    }

    // --- input -----------------------------------------------------------

    _press(ev) {
        if (ev.get_button() !== 1 || this._overUI(ev))
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (this._phase === 'select') {
            this._start = [x, y];
            this._sel = {x, y, w: 0, h: 0};
            this._dragging = true;
            return Clutter.EVENT_STOP;
        }
        if (this._palette) {
            this._closePalette();
            return Clutter.EVENT_STOP;
        }
        if (this._entry) {
            this._commitText();
            return Clutter.EVENT_STOP;
        }
        if (!this._inSel(x, y))
            return Clutter.EVENT_STOP;
        const lx = x - this._sel.x, ly = y - this._sel.y;
        const rgb = hexRgb(COLORS[this._color]);
        const width = WIDTHS[this._width][1];
        if (this._tool === 'text') {
            this._openEntry(x, y, lx, ly);
            return Clutter.EVENT_STOP;
        }
        this._cur = {type: this._tool, rgb, width, x1: lx, y1: ly, x2: lx, y2: ly, pts: [[lx, ly]]};
        this._dragging = true;
        return Clutter.EVENT_STOP;
    }

    _motion(ev) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (this._phase === 'select') {
            const [sx, sy] = this._start;
            const x0 = Math.max(0, Math.min(sx, x)), y0 = Math.max(0, Math.min(sy, y));
            const x1 = Math.min(this._W, Math.max(sx, x)), y1 = Math.min(this._H, Math.max(sy, y));
            this._sel = {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
            this._layoutDim();
        } else if (this._cur) {
            const lx = x - this._sel.x, ly = y - this._sel.y;
            this._cur.x2 = lx;
            this._cur.y2 = ly;
            if (this._cur.type === 'pen')
                this._cur.pts.push([lx, ly]);
            this._area.queue_repaint();
        }
        return Clutter.EVENT_STOP;
    }

    _release(ev) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        this._dragging = false;
        if (this._phase === 'select') {
            if (this._sel.w < MIN_SELECTION || this._sel.h < MIN_SELECTION) {
                this._sel = null;
                this._layoutDim();
            } else {
                this._enterEdit().catch(e => {
                    logError(e, 'zenshot: edit failed');
                    this.close();
                });
            }
        } else if (this._cur) {
            const a = this._cur;
            this._cur = null;
            const moved = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= 2;
            if (moved)
                this._anns.push(a);
            this._area.queue_repaint();
        }
        return Clutter.EVENT_STOP;
    }

    _key(ev) {
        const sym = ev.get_key_symbol();
        const ctrl = (ev.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if (this._palette) {
            if (sym === Clutter.KEY_Escape)
                this._closePalette();
            return Clutter.EVENT_STOP;
        }
        if (this._entry) {
            if (sym === Clutter.KEY_Escape)
                this._closeEntry();
            return Clutter.EVENT_PROPAGATE;
        }
        if (sym === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (this._phase !== 'edit')
            return Clutter.EVENT_STOP;
        if (ctrl && (sym === Clutter.KEY_z || sym === Clutter.KEY_Z)) {
            this._undo();
        } else if (ctrl && (sym === Clutter.KEY_s || sym === Clutter.KEY_S)) {
            this._finish(true);
        } else if ((ctrl && (sym === Clutter.KEY_c || sym === Clutter.KEY_C)) ||
                   sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
            this._finish(false);
        }
        return Clutter.EVENT_STOP;
    }

    // --- edit phase ------------------------------------------------------

    async _enterEdit() {
        const s = this._sel;
        const t0 = GLib.get_monotonic_time();
        // Output at the highest scale among the monitors the selection touches; a selection on one
        // monitor is a 1:1 copy of its pixels.
        const parts = this._views.filter(v =>
            v.x < s.x + s.w && s.x < v.x + v.w && v.y < s.y + s.h && s.y < v.y + v.h);
        const k = Math.max(1, ...parts.map(v => v.s));
        const base = new Cairo.ImageSurface(Cairo.Format.RGB24,
            Math.max(1, Math.round(s.w * k)), Math.max(1, Math.round(s.h * k)));
        const cr = new Cairo.Context(base);
        try {
            for (const v of parts) {
                const x0 = Math.max(s.x, v.x), y0 = Math.max(s.y, v.y);
                const x1 = Math.min(s.x + s.w, v.x + v.w), y1 = Math.min(s.y + s.h, v.y + v.h);
                const stream = Gio.MemoryOutputStream.new_resizable();
                await Shell.Screenshot.composite_to_stream(v.content.get_texture(),
                    Math.round((x0 - v.x) * v.s), Math.round((y0 - v.y) * v.s),
                    Math.max(1, Math.round((x1 - x0) * v.s)), Math.max(1, Math.round((y1 - y0) * v.s)),
                    v.s, null, 0, 0, 1, stream);
                stream.close(null);
                if (!this._active)
                    return;
                const tmp = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'zenshot-base.png']);
                GLib.file_set_contents(tmp, stream.steal_as_bytes().get_data());
                const img = Cairo.ImageSurface.createFromPNG(tmp);
                GLib.unlink(tmp);
                cr.save();
                cr.translate((x0 - s.x) * k, (y0 - s.y) * k);
                cr.scale(k / v.s, k / v.s);
                cr.setSourceSurface(img, 0, 0);
                cr.paint();
                cr.restore();
                img.finish();
            }
        } finally {
            cr.$dispose();
        }
        this._base = base;
        this._k = base.getWidth() / s.w;
        console.log(`zenshot: crop ${base.getWidth()}x${base.getHeight()} @${k}x ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(0)} ms`);

        this._phase = 'edit';
        this._setCursor(Clutter.CursorType.DEFAULT);
        this._area = new St.DrawingArea({reactive: true, x: s.x, y: s.y, width: s.w, height: s.h});
        this._area.connect('repaint', a => this._guard(() => this._repaint(a)));
        this._root.insert_child_above(this._area, this._border);
        this._buildToolbar();
        this._area.queue_repaint();
        this._root.grab_key_focus();
    }

    _buildToolbar() {
        const bar = new St.BoxLayout({
            style: 'background-color: rgba(30,30,30,0.95); border-radius: 10px; padding: 6px; spacing: 6px;',
        });
        this._toolbar = bar;
        this._toolBtns = {};
        const btn = (content, tip, cb, style = BTN_STYLE) => {
            const b = new St.Button({
                ...(typeof content === 'string' ? {label: content} : {child: content}),
                can_focus: false, reactive: true, style,
            });
            b.connect('clicked', () => this._guard(() => {
                this._hideTip();
                this._closePalette();
                cb();
                this._root?.grab_key_focus();
            }));
            this._addTip(b, tip);
            return b;
        };
        const sep = () => bar.add_child(new St.Widget({style: 'background-color: #666; width: 1px; margin: 3px 2px;'}));

        for (const [id, label] of TOOLS) {
            const b = btn(makeIcon(id), label, () => this._setTool(id));
            this._toolBtns[id] = b;
            bar.add_child(b);
        }
        sep();
        this._colorBtn = new St.Button({can_focus: false, reactive: true, y_align: Clutter.ActorAlign.CENTER});
        this._colorBtn.connect('clicked', () => this._guard(() => {
            this._hideTip();
            this._togglePalette();
            this._root?.grab_key_focus();
        }));
        this._addTip(this._colorBtn, 'Colour');
        bar.add_child(this._colorBtn);
        sep();
        this._widthBtns = WIDTHS.map(([label], i) => {
            const b = btn(label, ['Thin', 'Medium', 'Thick'][i], () => {
                this._width = i;
                this._syncToolbar();
            }, TXT_STYLE);
            bar.add_child(b);
            return b;
        });
        sep();
        bar.add_child(btn(themeIcon('edit-undo-symbolic'), 'Undo (Ctrl+Z)', () => this._undo()));
        bar.add_child(btn(themeIcon('document-save-symbolic'), 'Save (Ctrl+S)', () => this._finish(true)));
        bar.add_child(btn(themeIcon('edit-copy-symbolic'), 'Copy (Enter)', () => this._finish(false),
            `${BTN_STYLE} background-color: #26a269;`));
        bar.add_child(btn(themeIcon('window-close-symbolic'), 'Close (Esc)', () => this.close()));
        this._root.add_child(bar);

        const s = this._sel;
        const [, bw] = bar.get_preferred_width(-1);
        const [, bh] = bar.get_preferred_height(bw);
        const mon = this._monitorAt(s.x, s.y);
        let y = s.y + s.h + 8;
        if (y + bh > mon.y + mon.height)
            y = s.y - bh - 8;
        if (y < mon.y)
            y = Math.min(s.y + s.h - bh - 8, mon.y + mon.height - bh - 8);
        const x = Math.max(mon.x, Math.min(s.x + s.w - bw, mon.x + mon.width - bw));
        bar.set_position(Math.round(x), Math.round(y));
        this._syncToolbar();
    }

    _monitorAt(x, y) {
        return Main.layoutManager.monitors.find(m =>
            x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) ??
            Main.layoutManager.primaryMonitor;
    }

    // Puts a popup (palette, tooltip) under the toolbar, or above it when there is no room,
    // centred on the anchor button.
    _place(actor, anchor) {
        const [bx, by] = this._toolbar.get_transformed_position();
        const [, bh] = this._toolbar.get_transformed_size();
        const [ax, , ] = anchor.get_transformed_position();
        const [aw] = anchor.get_transformed_size();
        const [, pw] = actor.get_preferred_width(-1);
        const [, ph] = actor.get_preferred_height(pw);
        const mon = this._monitorAt(bx, by);
        let y = by + bh + 6;
        if (y + ph > mon.y + mon.height)
            y = by - ph - 6;
        const x = Math.max(mon.x, Math.min(ax + aw / 2 - pw / 2, mon.x + mon.width - pw));
        actor.set_position(Math.round(x), Math.round(y));
    }

    _addTip(b, text) {
        b.connect('notify::hover', () => this._guard(() => {
            if (b.hover && !this._palette && this._root)
                this._showTip(b, text);
            else
                this._hideTip();
        }));
    }

    _showTip(b, text) {
        this._hideTip();
        const tip = new St.Label({
            text,
            style: 'background-color: rgba(0,0,0,0.9); color: white; padding: 3px 8px; border-radius: 6px; font-size: 11px;',
        });
        this._root.add_child(tip);
        this._tip = tip;
        this._place(tip, b);
    }

    _hideTip() {
        this._tip?.destroy();
        this._tip = null;
    }

    _togglePalette() {
        if (this._palette) {
            this._closePalette();
            return;
        }
        const pal = new St.BoxLayout({
            vertical: true,
            style: 'background-color: rgba(30,30,30,0.95); border-radius: 10px; padding: 6px; spacing: 2px;',
        });
        this._swatches = [];
        for (let r = 0; r < 2; r++) {
            const row = new St.BoxLayout({style: 'spacing: 2px;'});
            COLORS.slice(r * 6, r * 6 + 6).forEach((css, j) => {
                const i = r * 6 + j;
                const b = new St.Button({can_focus: false, reactive: true});
                b._css = css;
                b.connect('clicked', () => this._guard(() => {
                    this._color = i;
                    this._closePalette();
                    this._syncToolbar();
                    this._root?.grab_key_focus();
                }));
                row.add_child(b);
                this._swatches.push(b);
            });
            pal.add_child(row);
        }
        this._root.add_child(pal);
        this._palette = pal;
        this._syncToolbar();
        this._place(pal, this._colorBtn);
    }

    _closePalette() {
        this._palette?.destroy();
        this._palette = null;
        this._swatches = null;
    }

    _setTool(id) {
        this._tool = id;
        this._syncToolbar();
    }

    _syncToolbar() {
        for (const [id, b] of Object.entries(this._toolBtns))
            b.style = id === this._tool ? BTN_ACTIVE : BTN_STYLE;
        this._colorBtn.style = circleStyle(COLORS[this._color], 'white');
        this._swatches?.forEach((b, i) => {
            b.style = circleStyle(b._css, i === this._color ? '#3584e4' : 'rgba(255,255,255,0.35)');
        });
        this._widthBtns.forEach((b, i) => {
            b.style = i === this._width ? TXT_ACTIVE : TXT_STYLE;
        });
    }

    _undo() {
        this._anns.pop();
        this._area.queue_repaint();
    }

    // --- text tool -------------------------------------------------------

    _fontSize(width) {
        return 12 + width * 3;
    }

    _openEntry(sx, sy, lx, ly) {
        const css = COLORS[this._color];
        const size = this._fontSize(WIDTHS[this._width][1]);
        this._entryPos = {lx, ly, rgb: hexRgb(css), size};
        this._entry = new St.Entry({
            x: sx, y: sy, width: 260, can_focus: true,
            style: `padding: 0; margin: 0; min-height: 0; background-color: rgba(0,0,0,0.35); color: ${css}; ` +
                   `border: 1px dashed #3584e4; font: bold ${size}px sans-serif; caret-color: ${css};`,
        });
        this._root.add_child(this._entry);
        this._entry.clutter_text.connect('activate', () => this._guard(() => this._commitText()));
        this._entry.grab_key_focus();
    }

    _commitText() {
        const text = this._entry?.get_text() ?? '';
        const p = this._entryPos;
        if (text.trim()) {
            this._anns.push({type: 'text', rgb: p.rgb, text, size: p.size, x1: p.lx, y1: p.ly, x2: p.lx, y2: p.ly, pts: []});
            this._area.queue_repaint();
        }
        this._closeEntry();
    }

    _closeEntry() {
        this._entry?.destroy();
        this._entry = null;
        this._root.grab_key_focus();
    }

    // --- drawing ---------------------------------------------------------

    _repaint(area) {
        const cr = area.get_context();
        try {
            this._paintAll(cr, this._cur ? [...this._anns, this._cur] : this._anns, 1 / this._k);
        } finally {
            cr.$dispose();
        }
    }

    // `baseScale` converts base-surface pixels to the drawing coordinate space.
    _paintBase(cr, baseScale) {
        cr.save();
        cr.scale(baseScale, baseScale);
        cr.setSourceSurface(this._base, 0, 0);
        cr.paint();
        cr.restore();
    }

    _paintAll(cr, anns, baseScale) {
        this._paintBase(cr, baseScale);
        for (const a of anns)
            this._paintAnn(cr, a, baseScale);
    }

    _paintAnn(cr, a, baseScale) {
        const [r, g, b] = a.rgb;
        cr.save();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineWidth(a.width ?? 2);
        cr.setSourceRGBA(r, g, b, 1);
        const rx = Math.min(a.x1, a.x2), ry = Math.min(a.y1, a.y2);
        const rw = Math.abs(a.x2 - a.x1), rh = Math.abs(a.y2 - a.y1);
        switch (a.type) {
        case 'line':
            cr.moveTo(a.x1, a.y1);
            cr.lineTo(a.x2, a.y2);
            cr.stroke();
            break;
        case 'arrow': {
            const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
            const head = Math.max(12, a.width * 4.5);
            const spread = Math.PI / 7;
            const bx = a.x2 - head * 0.8 * Math.cos(ang), by = a.y2 - head * 0.8 * Math.sin(ang);
            cr.moveTo(a.x1, a.y1);
            cr.lineTo(bx, by);
            cr.stroke();
            cr.moveTo(a.x2, a.y2);
            cr.lineTo(a.x2 - head * Math.cos(ang - spread), a.y2 - head * Math.sin(ang - spread));
            cr.lineTo(a.x2 - head * Math.cos(ang + spread), a.y2 - head * Math.sin(ang + spread));
            cr.closePath();
            cr.fill();
            break;
        }
        case 'rect':
            cr.rectangle(rx, ry, rw, rh);
            cr.stroke();
            break;
        case 'area':
            cr.setSourceRGBA(r, g, b, 0.3);
            cr.rectangle(rx, ry, rw, rh);
            cr.fillPreserve();
            cr.setSourceRGBA(r, g, b, 1);
            cr.setLineWidth(2);
            cr.stroke();
            break;
        case 'pen':
            cr.moveTo(...a.pts[0]);
            for (const p of a.pts.slice(1))
                cr.lineTo(...p);
            cr.stroke();
            break;
        case 'blur':
            this._paintBlur(cr, rx, ry, rw, rh, baseScale);
            break;
        case 'text':
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
            cr.setFontSize(a.size);
            cr.moveTo(a.x1, a.y1 + a.size * 0.85);
            cr.showText(a.text);
            break;
        }
        cr.restore();
    }

    // Mosaic: shrink the base region to one pixel per block, then enlarge with nearest-neighbour.
    _paintBlur(cr, x, y, w, h, baseScale) {
        if (w < 1 || h < 1)
            return;
        const B = BLUR_BLOCK;
        const bw = Math.max(1, Math.ceil(w / B)), bh = Math.max(1, Math.ceil(h / B));
        const small = new Cairo.ImageSurface(Cairo.Format.ARGB32, bw, bh);
        const sc = new Cairo.Context(small);
        sc.scale(1 / B, 1 / B);
        sc.translate(-x, -y);
        sc.scale(baseScale, baseScale);
        sc.setSourceSurface(this._base, 0, 0);
        try {
            sc.getSource().setFilter(Cairo.Filter.BEST);
        } catch (e) {
            // default filter is fine
        }
        sc.paint();
        sc.$dispose();

        cr.save();
        cr.rectangle(x, y, w, h);
        cr.clip();
        cr.translate(x, y);
        cr.scale(B, B);
        cr.setSourceSurface(small, 0, 0);
        cr.getSource().setFilter(Cairo.Filter.NEAREST);
        cr.paint();
        cr.restore();
    }

    // --- output ----------------------------------------------------------

    _renderPng() {
        const w = this._base.getWidth(), h = this._base.getHeight();
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        const cr = new Cairo.Context(surf);
        cr.scale(this._k, this._k);
        this._paintAll(cr, this._anns, 1 / this._k);
        cr.$dispose();
        const tmp = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'zenshot-out.png']);
        surf.writeToPNG(tmp);
        surf.finish();
        const [, data] = GLib.file_get_contents(tmp);
        GLib.unlink(tmp);
        return new GLib.Bytes(data);
    }

    _finish(save) {
        if (this._entry)
            this._commitText();
        const t0 = GLib.get_monotonic_time();
        const bytes = this._renderPng();
        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
        let where = '';
        if (save)
            where = this._save(bytes);
        Main.notify(save ? 'Screenshot saved and copied' : 'Screenshot copied to clipboard', where);
        console.log(`zenshot: export ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(0)} ms`);
        this.close();
    }

    _save(bytes) {
        const dir = GLib.build_filenamev([
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
            'Screenshots',
        ]);
        GLib.mkdir_with_parents(dir, 0o755);
        const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
        const path = GLib.build_filenamev([dir, `Screenshot From ${stamp} (edited).png`]);
        GLib.file_set_contents(path, bytes.get_data());
        return path;
    }

    close() {
        this._active = false;
        this._dragging = false;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._root) {
            this._root.destroy();
            this._root = null;
        }
        this._entry = null;
        this._toolbar = null;
        this._palette = null;
        this._swatches = null;
        this._tip = null;
        this._area = null;
        this._views = null;
        this._base = null;
    }
}

// Called on the freshly imported copy of this file, see enable().
export function start(ext) {
    const editor = new Editor();
    const settings = ext.getSettings();
    Main.wm.addKeybinding('trigger', settings, Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL, () => editor.start());
    return () => {
        Main.wm.removeKeybinding('trigger');
        editor.close();
    };
}

// ponytail: enable() re-imports this file through a symlink named after its mtime, so `make install`
// (disable + enable) runs new code without a re-login. GJS caches modules by path and ignores query
// strings, hence the symlink. Changes to this class or to metadata.json still need a re-login.
export default class Zenshot extends Extension {
    async enable() {
        const js = this.dir.get_child('extension.js');
        const tag = js.query_info('etag::value', Gio.FileQueryInfoFlags.NONE, null).get_etag();
        const link = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_runtime_dir(), 'zenshot', `${tag.replace(/\W/g, '_')}.js`]));
        if (!link.query_exists(null)) {
            GLib.mkdir_with_parents(link.get_parent().get_path(), 0o700);
            link.make_symbolic_link(js.get_path(), null);
        }
        const token = this._token = Symbol('enable');
        const live = await import(link.get_uri());
        if (this._token === token) // not disabled while importing
            this._stop = live.start(this);
    }

    disable() {
        this._token = null;
        this._stop?.();
        this._stop = null;
    }
}
