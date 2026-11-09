import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {History, chooseMime, MAX_IMAGE_BYTES, MAX_TEXT_BYTES} from './history.js';
import {Storage} from './storage.js';
import {HistoryPanel} from './ui.js';
import {pasteKeycodes} from './paste.js';

const CLIPBOARD = Meta.SelectionType.SELECTION_CLIPBOARD;

export default class Dvbuf extends Extension {
    enable() {
        this.active = true;
        const lifecycle = {};
        this.lifecycle = lifecycle;
        this.generation = (this.generation ?? 0) + 1;
        this.history = new History();
        this.settings = this.getSettings();
        this.message = 'Загрузка истории…';
        this.loaded = false;
        // GNOME may disable/enable this same instance while rebasing extensions.
        // Keep the writer queue so the next load cannot race an earlier pin/save.
        this.storage ??= new Storage();
        this.selection = global.display.get_selection();
        this.keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.selecting = false;
        this.panel = new HistoryPanel(this);
        Main.wm.addKeybinding('toggle-history', this.settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW |
                Shell.ActionMode.SYSTEM_MODAL | Shell.ActionMode.POPUP,
            () => {
                if (this.panel.isOpen)
                    this.panel.close();
                else if (Main.modalCount === 0)
                    this.panel.open();
            });
        this.ownerSignal = this.selection.connect('owner-changed', (_selection, type, owner) => {
            if (type === CLIPBOARD) {
                this.cancelCapture();
                if (owner)
                    this.capture();
            }
        });
        this.storage.queue.then(() => this.storage.load()).then(history => {
            if (!this.active || this.lifecycle !== lifecycle)
                return;
            this.history = history;
            this.loaded = true;
            this.message = '';
            this.panel.render();
            this.capture();
        }).catch(error => {
            if (this.lifecycle === lifecycle)
                this.report('История не прочитана; запись отключена, чтобы сохранить файл', error);
        });
    }

    cancelCapture() {
        this.generation++;
        this.captureCancellation?.cancel();
        this.captureCancellation = null;
        if (this.captureTimeout) {
            GLib.source_remove(this.captureTimeout);
            this.captureTimeout = 0;
        }
    }

    capture() {
        if (!this.active || !this.loaded || Main.sessionMode.isLocked)
            return;
        const mime = chooseMime(this.selection.get_mimetypes(CLIPBOARD) ?? []);
        if (!mime)
            return;
        const image = mime.startsWith('image/');
        const limit = image ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
        const generation = this.generation;
        const output = Gio.MemoryOutputStream.new_resizable();
        const cancellation = new Gio.Cancellable();
        this.captureCancellation = cancellation;
        this.captureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this.captureTimeout = 0;
            cancellation.cancel();
            return GLib.SOURCE_REMOVE;
        });
        // Mutter enforces a bound while reading, before content enters JS memory.
        this.selection.transfer_async(CLIPBOARD, mime, limit + 1, output, cancellation,
            (selection, result) => {
                try {
                    selection.transfer_finish(result);
                    output.close(null);
                    if (!this.active || generation !== this.generation)
                        return;
                    const bytes = output.steal_as_bytes();
                    if (!bytes.get_size() || bytes.get_size() > limit)
                        return;
                    const data = bytes.get_data();
                    const text = image ? undefined : new TextDecoder().decode(data);
                    if (!image && !text.trim())
                        return;
                    const id = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
                    const entry = {
                        id, mime: image ? mime : 'text/plain', size: data.length,
                        text, createdAt: Date.now(), pinned: false,
                    };
                    if (this.history.add(entry))
                        this.save(image ? {id, data} : null);
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Dvbuf: clipboard transfer failed (${error.code ?? 'unknown'})`);
                } finally {
                    if (generation === this.generation) {
                        if (this.captureTimeout)
                            GLib.source_remove(this.captureTimeout);
                        this.captureTimeout = 0;
                        this.captureCancellation = null;
                    }
                    try { output.close(null); } catch { /* Already closed. */ }
                }
            });
    }

    async save(image = null) {
        if (!this.loaded)
            return;
        const lifecycle = this.lifecycle;
        try {
            await this.storage.save(this.history.entries, image);
            if (this.active && lifecycle === this.lifecycle) {
                this.message = '';
                this.panel.render();
            }
        } catch (error) {
            if (lifecycle === this.lifecycle)
                this.report('Не удалось сохранить историю на диск', error);
        }
    }

    async select(entry) {
        if (!this.active || !this.panel.isOpen || this.selecting)
            return;
        this.selecting = true;
        const lifecycle = this.lifecycle;
        const generation = this.pasteGeneration;
        const panel = this.panel;
        const target = panel.targetWindow;
        try {
            const clipboard = St.Clipboard.get_default();
            if (entry.mime === 'text/plain') {
                clipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text);
            } else {
                // Wait for pending image writes before restoring a newly captured item.
                await this.storage.queue;
                const bytes = await this.storage.imageBytes(entry.id);
                if (!this.active || lifecycle !== this.lifecycle || !panel.isOpen ||
                    generation !== this.pasteGeneration)
                    return;
                clipboard.set_content(St.ClipboardType.CLIPBOARD, entry.mime, bytes);
            }
            panel.close();
            if (target)
                this.schedulePaste(target);
        } catch (error) {
            if (lifecycle === this.lifecycle)
                this.report('Не удалось вставить запись', error);
        } finally {
            if (lifecycle === this.lifecycle)
                this.selecting = false;
        }
    }

    cancelPaste() {
        this.pasteGeneration = (this.pasteGeneration ?? 0) + 1;
        if (this.pasteTimeout) {
            GLib.source_remove(this.pasteTimeout);
            this.pasteTimeout = 0;
        }
    }

    schedulePaste(target) {
        this.cancelPaste();
        let attempts = 0;
        this.pasteTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            // Wait for Shell to release its grab and for the user to release
            // shortcut modifiers. Never inject keys into a different window.
            const focused = global.display.focus_window;
            if (!this.active || Main.sessionMode.isLocked || this.panel.isOpen ||
                !target.get_compositor_private() || (focused && focused !== target)) {
                this.pasteTimeout = 0;
                return GLib.SOURCE_REMOVE;
            }
            const modifiers = global.get_pointer()[2];
            const held = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
                Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK;
            if (!focused || Main.modalCount > 0 || Main.overview.visible || (modifiers & held)) {
                if (++attempts < 20)
                    return GLib.SOURCE_CONTINUE;
                this.pasteTimeout = 0;
                return GLib.SOURCE_REMOVE;
            }
            const time = GLib.get_monotonic_time();
            const keys = pasteKeycodes(target.get_wm_class());
            const pressed = [];
            try {
                for (const key of keys) {
                    this.keyboard.notify_key(time, key, Clutter.KeyState.PRESSED);
                    pressed.push(key);
                }
            } catch (error) {
                this.report('Не удалось отправить нажатие для вставки', error);
            } finally {
                for (const key of pressed.reverse())
                    this.keyboard.notify_key(time, key, Clutter.KeyState.RELEASED);
                this.pasteTimeout = 0;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    pin(id) {
        if (!this.loaded)
            return;
        this.history.pin(id);
        this.save();
    }

    remove(id) {
        if (!this.loaded)
            return;
        this.cancelCapture();
        this.history.remove(id);
        this.save();
    }

    clear() {
        if (!this.loaded)
            return;
        this.cancelPaste();
        this.cancelCapture();
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '');
        this.history.clear();
        this.save();
    }

    report(message, error) {
        // Never include clipboard payloads or parser error messages in logs.
        console.error(`Dvbuf: ${message} (${error.code ?? error.name ?? 'unknown'})`);
        if (this.active) {
            this.message = message;
            Main.notify('Dvbuf', message);
        }
    }

    disable() {
        this.active = false;
        this.cancelCapture();
        this.cancelPaste();
        Main.wm.removeKeybinding('toggle-history');
        if (this.ownerSignal)
            this.selection.disconnect(this.ownerSignal);
        this.panel?.destroy();
        this.panel = null;
        this.settings = null;
        this.selection = null;
        this.keyboard = null;
    }
}
