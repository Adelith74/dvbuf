import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

function button(label, callback, styleClass = 'clip-toolbar-button') {
    const actor = new St.Button({label, style_class: styleClass, can_focus: true});
    actor.connect('clicked', callback);
    return actor;
}

export class HistoryPanel {
    constructor(controller) {
        this.controller = controller;
        this.dialog = new ModalDialog.ModalDialog({
            styleClass: 'clip-dialog', destroyOnClose: false,
            shouldFadeIn: false, shouldFadeOut: false, shellReactive: true,
        });
        this.surface = this.dialog.dialogLayout.get_first_child();
        this.surface.x_align = Clutter.ActorAlign.END;
        this.surface.y_align = Clutter.ActorAlign.END;
        this.surface.x_expand = true;
        this.surface.y_expand = true;
        this.dialog._backgroundBin.x_expand = true;
        this.dialog._backgroundBin.y_expand = true;
        this.dialog.dialogLayout.x_expand = true;
        this.dialog.dialogLayout.y_expand = true;
        this.menuManager = new PopupMenu.PopupMenuManager(this.dialog);
        this.selected = 0;
        this.rows = [];
        this.confirmation = null;
        const content = this.dialog.contentLayout;
        this.focusTarget = content;
        content.can_focus = true;
        content.set_style('padding: 0; margin: 0; spacing: 8px;');
        this.dialog.buttonLayout.hide();
        this.scroll = new St.ScrollView({style_class: 'clip-scroll', overlay_scrollbars: false, x_expand: true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.list = new St.BoxLayout({vertical: true, style_class: 'clip-list', x_expand: true});
        this.scroll.set_child(this.list);
        content.add_child(this.scroll);
        content.add_child(button('Очистить полностью', () => this.confirmClear(), 'clip-clear'));
        this.dialog.setInitialKeyFocus(content);
        this.keySignal = this.dialog.connect('captured-event', (_actor, event) => this.keyEvent(event));
    }

    get isOpen() {
        return this.dialog.state === ModalDialog.State.OPENED || this.dialog.state === ModalDialog.State.OPENING;
    }

    open() {
        if (!this.controller.loaded || this.controller.history.entries.length === 0)
            return;
        if (this.isOpen)
            return;
        this.controller.cancelPaste();
        this.targetWindow = global.display.focus_window;
        this.render();
        this.dialog.open();
    }

    close() {
        this.controller.cancelPaste();
        this.menu?.close();
        this.confirmation?.close();
        this.dialog.close();
    }

    render() {
        this.menu?.destroy();
        this.menu = null;
        const oldId = this.rows[this.selected]?.entry.id;
        this.list.destroy_all_children();
        this.rows = [];
        const entries = this.controller.history.search();
        for (const entry of entries) {
            const row = new St.BoxLayout({style_class: 'clip-card', x_expand: true});
            const choose = new St.Button({style_class: 'clip-card-content', x_expand: true, can_focus: true});
            const body = new St.BoxLayout({vertical: true, x_expand: true});
            if (entry.mime === 'text/plain') {
                const label = new St.Label({text: entry.text.slice(0, 700), style_class: 'clip-text', x_expand: true});
                label.clutter_text.line_wrap = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                body.add_child(label);
            } else {
                body.add_child(this.image(entry, 132));
            }
            choose.set_child(body);
            choose.connect('clicked', () => this.controller.select(entry));
            row.add_child(choose);
            const more = button('⋯', () => this.itemMenu(entry, more), 'clip-more');
            more.accessible_name = 'Действия с записью';
            more.y_align = Clutter.ActorAlign.START;
            row.add_child(more);
            this.rows.push({actor: row, entry});
            this.list.add_child(row);
        }
        this.selected = Math.max(0, this.rows.findIndex(row => row.entry.id === oldId));
        this.highlight(false);
        if (this.isOpen && this.controller.history.entries.length === 0)
            this.close();
        if (this.isOpen && !this.confirmation)
            this.focusTarget.grab_key_focus();
    }

    image(entry, size) {
        const texture = St.TextureCache.get_default().load_file_async(
            this.controller.storage.imageFile(entry.id), size === 132 ? 236 : 520, size,
            St.ThemeContext.get_for_stage(global.stage).scale_factor, 1);
        texture.x_align = Clutter.ActorAlign.CENTER;
        texture.y_align = Clutter.ActorAlign.CENTER;
        return new St.Bin({
            child: texture, style_class: 'clip-image', x_expand: true,
        });
    }

    highlight(scroll = true) {
        this.rows.forEach((row, i) => {
            if (i === this.selected)
                row.actor.add_style_class_name('clip-selected');
            else
                row.actor.remove_style_class_name('clip-selected');
        });
        const row = this.rows[this.selected]?.actor;
        if (scroll && row?.has_allocation()) {
            const box = row.get_allocation_box();
            const adjustment = this.scroll.vadjustment;
            if (box.y1 < adjustment.value)
                adjustment.value = box.y1;
            else if (box.y2 > adjustment.value + adjustment.page_size)
                adjustment.value = box.y2 - adjustment.page_size;
        }
    }

    keyEvent(event) {
        if (!this.isOpen || this.menu?.isOpen || this.confirmation)
            return Clutter.EVENT_PROPAGATE;
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            !this.surface.contains(global.stage.get_event_actor(event))) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (event.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Escape) {
            this.close();
        } else if (key === Clutter.KEY_Up || key === Clutter.KEY_Down) {
            this.selected = Math.max(0, Math.min(this.rows.length - 1,
                this.selected + (key === Clutter.KEY_Down ? 1 : -1)));
            this.highlight();
            this.focusTarget.grab_key_focus();
        } else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
            // Tab navigation leaves buttons usable, including the three-dot menu.
            if (global.stage.key_focus !== this.focusTarget)
                return Clutter.EVENT_PROPAGATE;
            const entry = this.rows[this.selected]?.entry;
            if (entry)
                this.controller.select(entry);
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    itemMenu(entry, source) {
        // A freshly rebuilt card has no anchor geometry until its first layout.
        if (!source.has_allocation() || !source.mapped)
            return;
        this.menu?.destroy();
        this.selected = this.rows.findIndex(row => row.entry.id === entry.id);
        this.highlight(false);
        this.menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.RIGHT);
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this.menuManager.addMenu(this.menu);
        this.menu.addAction(entry.pinned ? 'Открепить' : 'Закрепить навсегда', () => this.controller.pin(entry.id));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Удалить', () => this.controller.remove(entry.id));
        this.menu.open();
    }

    confirmClear() {
        if (!this.controller.loaded || this.confirmation)
            return;
        this.controller.cancelPaste();
        const dialog = new ModalDialog.ModalDialog({shouldFadeIn: false, shouldFadeOut: false});
        this.confirmation = dialog;
        const label = new St.Label({text: 'Удалить всю историю, включая закреплённые элементы?'});
        label.clutter_text.line_wrap = true;
        dialog.contentLayout.add_child(label);
        dialog.setButtons([
            {label: 'Отмена', key: Clutter.KEY_Escape, default: true, action: () => dialog.close()},
            {label: 'Удалить всё', action: () => { dialog.close(); this.controller.clear(); }},
        ]);
        dialog.connect('destroy', () => { this.confirmation = null; });
        dialog.open();
    }

    destroy() {
        this.dialog.disconnect(this.keySignal);
        this.menu?.destroy();
        this.confirmation?.destroy();
        this.dialog.destroy();
    }
}
