"""Exercise only disposable keyfile settings and XDG directories."""
import ast
import os
from pathlib import Path
import subprocess
import tempfile

manager = Path(__file__).resolve().parents[1] / 'manage.py'
with tempfile.TemporaryDirectory(prefix='dvbuf-install-test-') as root:
    env = dict(os.environ, XDG_DATA_HOME=f'{root}/data',
               XDG_CONFIG_HOME=f'{root}/config', GSETTINGS_BACKEND='keyfile')

    def settings(action, schema, key, value=None):
        args = ['gsettings', action, schema, key]
        if value is not None:
            args.append(repr(value))
        result = subprocess.run(args, env=env, text=True, capture_output=True, check=True)
        return ast.literal_eval(result.stdout.removeprefix('@as ').strip()) if action == 'get' else None

    shell, keys = 'org.gnome.shell', 'org.gnome.shell.keybindings'
    settings('set', shell, 'enabled-extensions', ['other@local'])
    settings('set', shell, 'disabled-extensions', ['disabled@local'])
    settings('set', keys, 'toggle-message-tray', ['<Super>v', '<Super>m'])
    subprocess.run(['/usr/bin/python3', str(manager), 'install'], env=env, check=True, capture_output=True)
    assert settings('get', shell, 'enabled-extensions') == ['other@local', 'clipdock@local']
    assert settings('get', shell, 'disabled-extensions') == ['disabled@local']
    assert settings('get', keys, 'toggle-message-tray') == ['<Super>m']
    settings('set', keys, 'toggle-message-tray', ['<Super>m', '<Control><Alt>n'])
    subprocess.run(['/usr/bin/python3', str(manager), 'uninstall'], env=env, check=True, capture_output=True)
    assert settings('get', shell, 'enabled-extensions') == ['other@local']
    assert settings('get', shell, 'disabled-extensions') == ['disabled@local']
    assert settings('get', keys, 'toggle-message-tray') == ['<Super>m', '<Control><Alt>n', '<Super>v']
    print('PASS: isolated install/uninstall preserves other extensions and later shortcut edits')
