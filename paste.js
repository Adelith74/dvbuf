const TERMINALS = new Set([
    'gnome-terminal', 'gnome-terminal-server', 'org.gnome.terminal',
    'kgx', 'org.gnome.console', 'tilix', 'com.gexperts.tilix',
    'kitty', 'alacritty', 'org.alacritty.alacritty', 'wezterm', 'org.wezfurlong.wezterm',
    'konsole', 'org.kde.konsole', 'terminator', 'xfce4-terminal',
]);

// Linux evdev codes: left Ctrl=29, left Shift=42, V=47. Keysyms such as
// Latin 'v' cannot be resolved by Mutter while a Russian layout is active.
export function pasteKeycodes(windowClass) {
    return TERMINALS.has((windowClass ?? '').toLowerCase())
        ? [29, 42, 47]
        : [29, 47];
}
