import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {History} from './history.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');

const encode = text => new TextEncoder().encode(text);

export class Storage {
    constructor(path = GLib.build_filenamev([GLib.get_user_data_dir(), 'clipdock'])) {
        this.directory = Gio.File.new_for_path(path);
        GLib.mkdir_with_parents(path, 0o700);
        this.directory.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
        this.index = this.directory.get_child('history.json');
        this.queue = Promise.resolve();
    }

    imageFile(id) {
        if (!/^[a-f0-9]{64}$/.test(id))
            throw new Error('Invalid image identifier');
        return this.directory.get_child(`${id}.image`);
    }

    async load() {
        try {
            const [contents] = await this.index.load_contents_async(null);
            const saved = JSON.parse(new TextDecoder().decode(contents));
            if (saved.version !== 1 || !Array.isArray(saved.entries))
                throw new Error('Unsupported history format');
            const history = new History(saved.entries);
            history.entries = history.entries.filter(item => item.mime === 'text/plain' ||
                this.imageFile(item.id).query_exists(null));
            return history;
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return new History();
            // Preserve a damaged file for recovery rather than silently overwriting it.
            throw error;
        }
    }

    async write(file, data) {
        await file.replace_contents_bytes_async(new GLib.Bytes(data), null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    save(entries, image = null) {
        const snapshot = entries.map(item => ({...item}));
        const operation = this.queue.then(async () => {
            if (image && snapshot.some(item => item.id === image.id))
                await this.write(this.imageFile(image.id), image.data);
            await this.write(this.index, encode(JSON.stringify({version: 1, entries: snapshot})));
            const keep = new Set(snapshot.filter(item => item.mime !== 'text/plain').map(item => `${item.id}.image`));
            const files = this.directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            try {
                let info;
                while ((info = files.next_file(null))) {
                    const name = info.get_name();
                    if (/^[a-f0-9]{64}\.image$/.test(name) && !keep.has(name))
                        await this.directory.get_child(name).delete_async(GLib.PRIORITY_DEFAULT, null);
                }
            } finally {
                files.close(null);
            }
        });
        // A failed write is reported to its caller; later operations can still succeed.
        this.queue = operation.catch(() => {});
        return operation;
    }

    async imageBytes(id) {
        const [data] = await this.imageFile(id).load_contents_async(null);
        return new GLib.Bytes(data);
    }
}
