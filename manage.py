#!/usr/bin/python3
"""Install/uninstall Dvbuf for the current GNOME user, preserving keybindings."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess

from gi.repository import Gio

# Keep these IDs stable so upgrades retain existing histories and uninstall state.
UUID = 'clipdock@local'
SOURCE = Path(__file__).resolve().parent
DATA = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
TARGET = DATA / 'gnome-shell/extensions' / UUID
STATE_DIR = DATA / 'clipdock-install'
STATE = STATE_DIR / 'state.json'
FILES = ['extension.js', 'history.js', 'storage.js', 'ui.js', 'paste.js', 'metadata.json', 'stylesheet.css', 'schemas']


def install():
    version = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    if version.split()[-1].split('.')[0] != '46':
        raise SystemExit(f'Требуется GNOME 46. Обнаружено: {version}')
    subprocess.run(['glib-compile-schemas', '--strict', str(SOURCE / 'schemas')], check=True)
    shell = Gio.Settings.new('org.gnome.shell')
    keys = Gio.Settings.new('org.gnome.shell.keybindings')
    if shell.get_boolean('disable-user-extensions'):
        raise SystemExit('Пользовательские расширения отключены глобально. Включи их в приложении «Расширения».')
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not STATE.exists():
        state = {
            'toggle-message-tray': keys.get_strv('toggle-message-tray'),
            'was-enabled': UUID in shell.get_strv('enabled-extensions'),
            'was-disabled': UUID in shell.get_strv('disabled-extensions'),
        }
        with STATE.open('x') as stream:
            os.chmod(STATE, 0o600)
            json.dump(state, stream, ensure_ascii=False, indent=2)
    if TARGET.exists():
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        shutil.copytree(TARGET, STATE_DIR / 'backups' / stamp)
    TARGET.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        source, dest = SOURCE / name, TARGET / name
        if source.is_dir():
            shutil.copytree(source, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(source, dest)
    # Keep every unrelated shortcut and extension unchanged.
    tray = [key for key in keys.get_strv('toggle-message-tray') if key.lower() not in ('<super>v', '<mod4>v')]
    keys.set_strv('toggle-message-tray', tray)
    enabled = shell.get_strv('enabled-extensions')
    if UUID not in enabled:
        shell.set_strv('enabled-extensions', [*enabled, UUID])
    shell.set_strv('disabled-extensions', [item for item in shell.get_strv('disabled-extensions') if item != UUID])
    Gio.Settings.sync()
    print(f'Установлено: {TARGET}')
    print('Выйди из сеанса GNOME и зайди снова. Затем нажми Win+V.')


def uninstall():
    shell = Gio.Settings.new('org.gnome.shell')
    keys = Gio.Settings.new('org.gnome.shell.keybindings')
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    shell.set_strv('enabled-extensions', [item for item in shell.get_strv('enabled-extensions') if item != UUID])
    disabled = [item for item in shell.get_strv('disabled-extensions') if item != UUID]
    if state.get('was-disabled'):
        disabled.append(UUID)
    shell.set_strv('disabled-extensions', disabled)
    if 'toggle-message-tray' in state:
        # Restore only the shortcut removed by this installer. Keep later user edits.
        current = keys.get_strv('toggle-message-tray')
        for key in state['toggle-message-tray']:
            if key.lower() in ('<super>v', '<mod4>v') and key not in current:
                current.append(key)
        keys.set_strv('toggle-message-tray', current)
    Gio.Settings.sync()
    if TARGET.exists():
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        destination = STATE_DIR / 'removed' / stamp
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(TARGET), str(destination))
    print(f'Dvbuf отключён. История сохранена в {DATA / "clipdock"}. Выйди и зайди снова.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'uninstall'])
    args = parser.parse_args()
    install() if args.action == 'install' else uninstall()
