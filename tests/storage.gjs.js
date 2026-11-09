import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Storage} from '../storage.js';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const root = GLib.dir_make_tmp('dvbuf-storage-test-XXXXXX');
const storage = new Storage(root);
const text = {id: 'a'.repeat(64), mime: 'text/plain', text: 'Закреплённый текст', pinned: true, size: 35, createdAt: 123};
const image = {id: 'b'.repeat(64), mime: 'image/png', pinned: false, size: 4, createdAt: 456};
try {
    await storage.save([text, image], {id: image.id, data: new Uint8Array([1, 2, 3, 4])});
    const restored = await new Storage(root).load();
    check(restored.entries.length === 2, 'Text and image survive a new Storage instance');
    check(restored.entries[0].pinned === true, 'Pin survives reload');
    check(restored.entries[0].text === text.text, 'UTF-8 text survives reload');
    check((await storage.imageBytes(image.id)).get_size() === 4, 'Image bytes survive reload');
    const mode = storage.index.query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode');
    check((mode & 0o777) === 0o600, 'History is private');
    const first = storage.save([text, image]);
    const second = storage.save([text]);
    await Promise.all([first, second]);
    check(!(storage.imageFile(image.id).query_exists(null)), 'Deleted image bytes are removed');
    check((await storage.load()).entries.length === 1, 'Latest queued snapshot wins');
    await storage.write(storage.index, new TextEncoder().encode('{broken'));
    let rejected = false;
    try { await storage.load(); } catch { rejected = true; }
    check(rejected, 'Damaged JSON is rejected rather than silently replaced');
    print('PASS: persistence, pins, UTF-8, image bytes, private permissions, write ordering, deletion, corruption');
} finally {
    const files = storage.directory.enumerate_children('standard::name', 0, null);
    let info;
    while ((info = files.next_file(null)))
        storage.directory.get_child(info.get_name()).delete(null);
    files.close(null);
    storage.directory.delete(null);
}
