#!/usr/bin/env python3
"""End-to-end workflow in real PTYs; all repos, editor output and state are temporary."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

PROJECT = Path(__file__).resolve().parent.parent
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
def plain(data):
    return ANSI.sub('', data.decode(errors='replace'))

def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True).stdout

class Viewer:
    def __init__(self, root, cache, width, editor, log):
        self.master, self.slave = pty.openpty()
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, width, 0, 0))
        self.initial = termios.tcgetattr(self.slave)
        self.process = subprocess.Popen(['node', str(PROJECT / 'dist/cli.js'), '--repo', str(root)],
            stdin=self.slave, stdout=self.slave, stderr=self.slave, start_new_session=True,
            env={**os.environ, 'FORCE_COLOR':'3', 'DIFFORA_LANG':'es', 'TERMINAL_REVIEW_STATE_DIR': str(cache),
                 'TERMINAL_REVIEW_EDITOR': editor, 'REVIEW_TEST_LOG': str(log)})
        self.wait('Base')
        self.drain(0.2)

    def send(self, value):
        self.drain(0.08)
        os.write(self.master, value.encode() if isinstance(value, str) else value)

    def wait(self, text, timeout=10):
        result = b''
        deadline = time.monotonic() + timeout
        while self.process.poll() is None and time.monotonic() < deadline:
            if select.select([self.master], [], [], 0.05)[0]:
                try:
                    result += os.read(self.master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if text in plain(result):
                    return result + self.drain(0.12)
        raise AssertionError(f'Missing {text!r}: {plain(result)[-4000:]}')

    def drain(self, seconds=0.12):
        result = b''
        deadline = time.monotonic() + seconds
        while self.process.poll() is None and time.monotonic() < deadline:
            if select.select([self.master], [], [], min(0.02, max(0, deadline - time.monotonic())))[0]:
                try: result += os.read(self.master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO: raise
        return result

    def pending_files(self, expected='Archivos'):
        self.send('w'); self.wait('Pendientes')
        self.send('\r'); return self.wait(expected)

    def quit(self):
        self.send('q')
        self.drain(3)
        assert self.process.wait(timeout=5) == 0
        assert termios.tcgetattr(self.slave) == self.initial, 'TTY not restored'

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try: self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait(timeout=3)
        os.close(self.master); os.close(self.slave)

def await_file(path):
    deadline = time.monotonic() + 3
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.03)
    assert path.exists(), str(path)

def scenario(width):
    with tempfile.TemporaryDirectory(prefix='terminal-review-workflow-pty-') as folder:
        base = Path(folder)
        root, cache = base / 'repo', base / 'state'
        root.mkdir()
        git(root, 'init', '-b', 'main')
        git(root, 'config', 'user.name', 'Workflow PTY')
        git(root, 'config', 'user.email', 'workflow@example.invalid')
        git(root, 'config', 'commit.gpgsign', 'false')
        initial = [f'line {i}\n' for i in range(1, 61)]
        (root / 'a.txt').write_text(''.join(initial))
        (root / 'b.txt').write_text('before b\n')
        git(root, 'add', '.'); git(root, 'commit', '-m', 'Base')
        changed = initial.copy()
        changed[0], changed[34] = 'first changed\n', 'distant changed\n'
        (root / 'a.txt').write_text(''.join(changed))
        (root / 'b.txt').write_text('second changed\n')
        status = git(root, 'status', '--porcelain=v1', '-z')
        index = (root / '.git/index').read_bytes()
        stub, log = base / 'fake editor.mjs', base / 'editor.json'
        stub.write_text("import {writeFileSync} from 'node:fs'; writeFileSync(process.env.REVIEW_TEST_LOG, JSON.stringify(process.argv.slice(2)));")
        editor = f'"{shutil.which("node")}" "{stub}" "{{file}}" "{{line}}" "{{column}}"'

        ui = Viewer(root, cache, width, editor, log)
        try:
            ui.pending_files()
            ui.send('\r'); ui.wait('first changed')
            ui.send('j'); ui.wait('Bloque:')
            ui.send('j'); ui.wait('Bloque:')
            ui.send('e'); ui.wait('Enviado al editor')
            await_file(log)
            args = json.loads(log.read_text())
            assert Path(args[0]).resolve() == (root / 'a.txt').resolve(), args
            assert args[1:] == ['32', '1'], args
            ui.send('c'); ui.wait('Enter guardar')
            ui.send('hwrq revisar móvil')
            ui.send('\r'); ui.wait('Nota guardada')
            ui.send('t')
            frame = ui.wait('Tareas abiertas')
            assert 'hwrq revisar móvil' in plain(frame), plain(frame)
            ui.send('\r'); ui.wait('Archivos')
            ui.send('\r'); ui.wait('Diff · !')
            ui.send('m'); ui.wait('Diff · ✓')
            ui.send('f'); ui.wait('second changed')  # Green a disappears; next pending b is selected.
            ui.send('i')
            frame = ui.wait('Resumen de revisión')
            assert '2 archivos' in plain(frame) and '1 terminados' in plain(frame), plain(frame)
            ui.send('\x1b')
            ui.send('c'); ui.wait('Enter guardar')
            ui.send('Revisar desktop')
            ui.send('\r'); ui.wait('Nota guardada')
            ui.send('E'); ui.wait('Informe Markdown exportado')
            reports = list(cache.glob('exports/*/*.md'))
            assert len(reports) == 1, reports
            report = reports[0].read_text()
            assert '2 archivos · 1 terminados · 1 pendientes · 0 sin revisar' in report, report
            assert 'Revisar desktop' in report and 'hwrq revisar móvil' in report
            ui.quit()
        finally: ui.close()
        saved = json.loads(next(cache.glob('*.json')).read_text())
        assert len(saved['reviewed']) == 1 and len(saved['needsReview']) == 1, saved
        assert git(root, 'status', '--porcelain=v1', '-z') == status
        assert (root / '.git/index').read_bytes() == index

        # New process: both colors must be restored before opening the diff.
        ui = Viewer(root, cache, width, editor, log)
        try:
            frame = ui.pending_files('1/2 ✓')
            assert '●' in plain(frame), plain(frame)
            assert b'\x1b[32m' in frame and b'38;2;255;158;69m' in frame, plain(frame)
            changed[0] = 'changed after review\n'
            (root / 'a.txt').write_text(''.join(changed))
            ui.wait('0/2 ✓', timeout=12)  # No r: background audit must invalidate green.
            ui.send('t')
            frame = ui.wait('Tareas abiertas')
            assert 'contenido cambiado' in plain(frame), plain(frame)
            assert 'hwrq revisar móvil' in plain(frame), plain(frame)
            ui.send('E'); ui.wait('Informe Markdown exportado')
            assert any('Nota obsoleta: contenido cambiado' in path.read_text() for path in cache.glob('exports/*/*.md'))
            ui.quit()
        finally: ui.close()

        # Change b while closed: startup must invalidate orange too, preserving both notes.
        (root / 'b.txt').write_text('new b after closing\n')
        ui = Viewer(root, cache, width, editor, log)
        try:
            ui.pending_files('0/2 ✓')
            ui.send('i')
            frame = ui.wait('Resumen de revisión')
            assert '0 pendientes' in plain(frame) and '2 sin revisar' in plain(frame), plain(frame)
            ui.quit()
        finally: ui.close()
        saved = json.loads(next(cache.glob('*.json')).read_text())
        assert saved['reviewed'] == [] and saved['needsReview'] == [], saved
        assert len(saved['notes']) == 2 and all(note['stale'] for note in saved['notes'].values()), saved
        assert (root / '.git/index').read_bytes() == index
        print(f'PASS workflow PTY {width}: notes, filter, hunks, editor, export, restart, automatic invalidation', flush=True)

for width in [140, 80, 40]:
    scenario(width)
