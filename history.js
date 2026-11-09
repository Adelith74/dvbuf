// No GNOME dependencies: the ordering and retention rules can be tested in Node.
export const MAX_ITEMS = 100;
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const PRIVATE_MIMES = [
    'x-kde-passwordManagerHint', 'application/x-keepassxc',
    'application/x-kpx-password', 'org.nspasteboard.ConcealedType',
    'application/x-gnome-copied-files', 'x-special/gnome-copied-files',
];

export function chooseMime(mimes) {
    if (PRIVATE_MIMES.some(mime => mimes.includes(mime)))
        return null;
    return IMAGE_MIMES.find(mime => mimes.includes(mime)) ??
        ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING'].find(mime => mimes.includes(mime)) ?? null;
}

export function validEntry(entry) {
    return entry && /^[a-f0-9]{64}$/.test(entry.id) &&
        (entry.mime === 'text/plain' || IMAGE_MIMES.includes(entry.mime)) &&
        Number.isSafeInteger(entry.size) && entry.size > 0 &&
        entry.size <= (entry.mime === 'text/plain' ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES) &&
        Number.isFinite(entry.createdAt) && typeof entry.pinned === 'boolean' &&
        (entry.mime !== 'text/plain' || typeof entry.text === 'string');
}

export class History {
    constructor(entries = [], maxItems = MAX_ITEMS, maxBytes = MAX_BYTES) {
        this.maxItems = maxItems;
        this.maxBytes = maxBytes;
        this.entries = [];
        for (const entry of entries) {
            if (validEntry(entry) && !this.entries.some(item => item.id === entry.id))
                this.entries.push({...entry});
        }
        // Malformed/oversized stores must never bypass the hard budget, even with pins.
        while (this.entries.length > maxItems || this.bytes > maxBytes)
            this.entries.pop();
    }

    get bytes() {
        return this.entries.reduce((total, item) => total + item.size, 0);
    }

    add(entry) {
        if (!validEntry(entry))
            return false;
        const previous = this.entries.find(item => item.id === entry.id);
        const next = [
            {...entry, pinned: previous?.pinned ?? entry.pinned},
            ...this.entries.filter(item => item.id !== entry.id),
        ];
        const bytes = () => next.reduce((total, item) => total + item.size, 0);
        while (next.length > this.maxItems || bytes() > this.maxBytes) {
            const index = next.findLastIndex((item, i) => i > 0 && !item.pinned);
            if (index < 0)
                return false; // Do not evict pinned items or destroy the old history.
            next.splice(index, 1);
        }
        this.entries = next;
        return true;
    }

    remove(id) {
        this.entries = this.entries.filter(item => item.id !== id);
    }

    pin(id) {
        const item = this.entries.find(entry => entry.id === id);
        if (item)
            item.pinned = !item.pinned;
    }

    clear() {
        this.entries = [];
    }

    search(query = '') {
        const needle = query.trim().toLocaleLowerCase();
        return this.entries.filter(item => !needle ||
            (item.mime === 'text/plain' ? item.text : 'изображение картинка image').toLocaleLowerCase().includes(needle))
            .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
}
