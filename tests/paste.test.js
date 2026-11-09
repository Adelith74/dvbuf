import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pasteKeycodes} from '../paste.js';

test('ordinary apps use Ctrl+V', () => {
    for (const name of [null, 'org.dvbuf.TestInput', 'firefox', 'Code'])
        assert.deepEqual(pasteKeycodes(name), [29, 47]);
});

test('terminals use Ctrl+Shift+V without altering normal applications', () => {
    for (const name of ['Gnome-terminal-server', 'org.gnome.Console', 'kitty', 'Alacritty', 'konsole'])
        assert.deepEqual(pasteKeycodes(name), [29, 42, 47]);
    assert.deepEqual(pasteKeycodes('my-terminal-editor'), [29, 47]);
});
