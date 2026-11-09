import {test} from 'node:test';
import assert from 'node:assert/strict';
import {History, chooseMime, MAX_TEXT_BYTES} from '../history.js';

const entry = (n, extra = {}) => ({id: n.toString(16).padStart(64, '0'), mime: 'text/plain', text: `текст ${n}`, size: 10, createdAt: n, pinned: false, ...extra});

test('deduplication promotes text while keeping its pin', () => {
    const history = new History();
    history.add(entry(1));
    history.pin(entry(1).id);
    history.add(entry(2));
    history.add(entry(1));
    assert.equal(history.entries.length, 2);
    assert.equal(history.entries[0].pinned, true);
});

test('retention evicts the oldest unpinned entry and preserves permanent pins', () => {
    const history = new History([], 3, 30);
    history.add(entry(1, {pinned: true}));
    history.add(entry(2));
    history.add(entry(3));
    history.add(entry(4));
    assert.deepEqual(history.entries.map(item => item.createdAt), [4, 3, 1]);
});

test('full pinned history rejects new content without losing existing records', () => {
    const history = new History([entry(1, {pinned: true}), entry(2, {pinned: true})], 2, 20);
    assert.equal(history.add(entry(3)), false);
    assert.deepEqual(history.entries.map(item => item.createdAt), [1, 2]);
});

test('pin, unpin, delete and clear have observable effects', () => {
    const history = new History([entry(1), entry(2)]);
    history.pin(entry(2).id);
    assert.equal(history.search()[0].id, entry(2).id);
    history.pin(entry(2).id);
    assert.equal(history.search()[0].id, entry(1).id);
    history.remove(entry(1).id);
    assert.equal(history.entries.length, 1);
    history.clear();
    assert.equal(history.entries.length, 0);
});

test('case insensitive text search and image search', () => {
    const history = new History([entry(1, {text: 'ПрИвЕт'}), entry(2, {mime: 'image/png'})]);
    assert.equal(history.search('привет')[0].id, entry(1).id);
    assert.equal(history.search('картинка')[0].id, entry(2).id);
});

test('restored history rejects malformed, duplicated and oversized entries', () => {
    const history = new History([entry(1), entry(1), entry(2, {size: MAX_TEXT_BYTES + 1}), entry(3, {id: '../../file'})]);
    assert.equal(history.entries.length, 1);
    const full = new History(Array.from({length: 120}, (_, i) => entry(i, {pinned: true})));
    assert.equal(full.entries.length, 100);
});

test('password hints and file operations are excluded; images take priority over text', () => {
    assert.equal(chooseMime(['text/plain', 'x-kde-passwordManagerHint']), null);
    assert.equal(chooseMime(['text/plain', 'image/png']), 'image/png');
    assert.equal(chooseMime(['text/plain', 'x-special/gnome-copied-files']), null);
    assert.equal(chooseMime(['text/html']), null);
});
