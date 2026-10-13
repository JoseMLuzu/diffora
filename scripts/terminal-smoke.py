#!/usr/bin/env python3
"""Real PTY smoke test on macOS/Linux. Requires npm install && npm run build."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
import zlib

PROJECT = Path(__file__).resolve().parent.parent

def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True).stdout

def collect(fd, process, expected, timeout=8):
    output = b''
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output += os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if expected.encode() in output:
                return output
        if process.poll() is not None:
            break
    raise AssertionError(f'Missing {expected!r}: {output.decode(errors="replace")[-3000:]}')

def drain_for(fd, process, seconds):
    # A real terminal consumes output continuously; emulate that while pausing.
    output = b''
    deadline = time.monotonic() + seconds
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([fd], [], [], min(0.03, max(0, deadline - time.monotonic())))[0]:
            try:
                output += os.read(fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
    return output

def session(root, width, exit_key, image=False):
    cache = tempfile.TemporaryDirectory(prefix='terminal-review-smoke-state-')
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, width, 0, 0))
    initial = termios.tcgetattr(slave)
    process = subprocess.Popen(['node', str(PROJECT / 'dist/cli.js'), '--repo', str(root)],
                               stdin=slave, stdout=slave, stderr=slave, start_new_session=True, env={**os.environ, 'FORCE_COLOR':'3', 'TERMINAL_REVIEW_STATE_DIR': cache.name})
    try:
        opening = collect(master, process, 'Historial')
        opening += drain_for(master, process, 0.2)
        if b'Publicados' not in opening:
            opening += collect(master, process, 'Publicados')
        assert '↑'.encode() in opening and b'\x1b[33m' in opening, 'Unpushed commits have no yellow arrow'
        assert b'--- Publicados' in opening, 'Published history separator is missing'
        assert b'\x1b[?1049h' in opening, 'Alternate screen was not enabled'
        if width >= 110:
            assert b'\x1b[?1002h' in opening and b'\x1b[?1006h' in opening, 'Drag reporting was not enabled'
            # Left edge: first panel grows, files shrink, diff stays unchanged.
            os.write(master, b'\x1b[<0;39;5M\x1b[<32;49;5M')
            collect(master, process, 'Anchos: commits 49 · archivos 25 · diff 66')
            os.write(master, b'\x1b[<0;49;5m')
            drain_for(master, process, 0.1)
            # Right edge uses the new layout and leaves the first panel alone.
            os.write(master, b'\x1b[<0;74;5M\x1b[<32;84;5M')
            collect(master, process, 'Anchos: commits 49 · archivos 35 · diff 56')
            # Drag beyond the window clamps at the diff's minimum width.
            os.write(master, b'\x1b[<32;999;5M')
            collect(master, process, 'Anchos: commits 49 · archivos 71 · diff 20')
            os.write(master, b'\x1b[<32;74;5M')
            collect(master, process, 'Anchos: commits 49 · archivos 25 · diff 66')
            os.write(master, b'\x1b[<0;74;5m')
            drain_for(master, process, 0.1)
        os.write(master, b'w')
        collect(master, process, 'Pendientes')
        # Open files and then the diff; the pending working-tree content must appear.
        os.write(master, b'\r')
        collect(master, process, 'panel 2/3')
        if not image:
            drain_for(master, process, 0.2)
            os.write(master, b'/')
            collect(master, process, 'Enter aplicar')
            # Late mouse reports must never become search text.
            os.write(master, b'\x1b[<0;49;5M\x1b[<32;59;5M\x1b[<0;59;5m')
            drain_for(master, process, 0.1)
            # Shortcut letters must be ordinary text while the search field is active.
            os.write(master, b'hwrq')
            collect(master, process, 'Sin coincidencias')
            drain_for(master, process, 0.1)
            os.write(master, b'\x7f')
            collect(master, process, '/ hwr')
            os.write(master, b'\x15')  # Ctrl+U
            drain_for(master, process, 0.1)
            os.write(master, b'SAMPLE')
            collect(master, process, '/ SAMPLE')
            os.write(master, b'\r')
            collect(master, process, '/ buscar')
            drain_for(master, process, 0.1)
        os.write(master, b'\r')
        if image:
            frame = collect(master, process, 'panel 3/3')
            assert '▀'.encode() in frame, 'Image pixels were not rendered'
            assert b'38;2;' in frame or b'48;2;' in frame, 'No RGB image colours rendered'
            drain_for(master, process, 0.2)
            os.write(master, b'v')
            collect(master, process, 'Anterior')
            drain_for(master, process, 0.2)
            os.write(master, b'v')
            collect(master, process, 'Nueva')
        else:
            collect(master, process, 'working')
            drain_for(master, process, 0.2)
            os.write(master, b's')
            if width >= 80:
                frame = collect(master, process, 'working')
                assert 'Anterior'.encode() in frame and 'Nueva'.encode() in frame and '│'.encode() in frame, f'Split columns missing: {frame.decode(errors="replace")}'
                assert b'48;2;' in frame, 'Split diff has no background colours'
                drain_for(master, process, 0.1)
                # Temporarily shrink the PTY; the preferred view must recover on enlargement.
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 40, 0, 0))
                os.kill(process.pid, signal.SIGWINCH)
                collect(master, process, 'Amplía a 80')
                drain_for(master, process, 0.1)
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, width, 0, 0))
                os.kill(process.pid, signal.SIGWINCH)
                collect(master, process, 'Anterior')
            else:
                collect(master, process, 'Amplía a 80')
            drain_for(master, process, 0.1)
            os.write(master, b'n')
            collect(master, process, 'Diff · !')
            drain_for(master, process, 0.1)
            os.write(master, b'm')
            collect(master, process, 'Diff · ✓')
            os.write(master, b'\x1b')
            marked = collect(master, process, '1/1 ✓')
            marked += drain_for(master, process, 0.15)
            assert b'\x1b[32m' in marked and '●'.encode() in marked, 'Reviewed file has no green dot'
            drain_for(master, process, 0.1)
            os.write(master, b'\x1b')  # Clear the filter, preserving the reviewed mark.
            collect(master, process, '1/1 ✓')
            drain_for(master, process, 0.1)
            os.write(master, b'm')
            collect(master, process, '0/1 ✓')
            os.write(master, b'\r')
            collect(master, process, 'panel 3/3')
            drain_for(master, process, 0.1)
            os.write(master, b's')  # Return to unified; review marks and navigation survived.
            collect(master, process, 'working')
        for key in [b'\x1b[A', b'\x1b[B', b'\t', b'\x1b']:
            os.write(master, key)
            drain_for(master, process, 0.1)
        os.write(master, b'h')
        collect(master, process, 'Historial')
        drain_for(master, process, 0.2)
        if not image:
            # Commit metadata can truncate the status footer in a 40-column terminal.
            # Check the visible panel headings instead of relying on that footer.
            os.write(master, b'\r')
            collect(master, process, 'Archivos ·')
            drain_for(master, process, 0.2)
            os.write(master, b'\r')
            collect(master, process, 'Diff ·')
            drain_for(master, process, 0.2)
            os.write(master, b'm')
            collect(master, process, 'Diff · ✓')
            os.write(master, b'\x1b')
            collect(master, process, 'Archivos ·')
            drain_for(master, process, 0.1)
            os.write(master, b'\x1b')
            marked = collect(master, process, 'Últimos 30 commits')
            marked += drain_for(master, process, 0.15)
            assert b'\x1b[32m' in marked and '●'.encode() in marked, 'Reviewed commit has no green dot'
            drain_for(master, process, 0.1)
            os.write(master, b'\r')
            collect(master, process, 'Archivos ·')
            drain_for(master, process, 0.1)
            os.write(master, b'\r')
            collect(master, process, 'Diff · ✓')
            drain_for(master, process, 0.1)
            os.write(master, b'n')
            collect(master, process, 'Diff · !')
            os.write(master, b'\x1b')
            marked = collect(master, process, '1 !')
            marked += drain_for(master, process, 0.15)
            assert b'\x1b[38;2;255;158;69m' in marked and '●'.encode() in marked, 'File needs-review has no orange dot'
            drain_for(master, process, 0.1)
            os.write(master, b'\x1b')
            marked = collect(master, process, 'Local')
            marked += drain_for(master, process, 0.15)
            assert b'\x1b[38;2;255;158;69m' in marked and '●'.encode() in marked, f'Commit needs-review has no orange dot: {marked.decode(errors="replace")}'
            drain_for(master, process, 0.1)
        os.write(master, b'r')
        drain_for(master, process, 0.4)
        # Identical refreshed content may not repaint; verify the UI still responds.
        os.write(master, b'?')
        collect(master, process, 'Ayuda')
        os.write(master, b'\x1b')
        drain_for(master, process, 0.1)
        os.write(master, exit_key)
        # Keep draining the PTY while Ink writes its final frame and restores it.
        final_output = b''
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    final_output += os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
        assert process.poll() == 0, f'Exit failed: {final_output.decode(errors="replace")[-2000:]}'
        assert b'\x1b[?1002l' in final_output and b'\x1b[?1006l' in final_output, 'Mouse reporting was not restored'
        assert b'\x1b[?1049l' in final_output, 'Original screen was not restored'
        assert termios.tcgetattr(slave) == initial, 'Terminal settings were not restored'
        print(f'PASS PTY {width} columns, exit {exit_key!r}, image={image}')
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        os.close(master)
        os.close(slave)
        cache.cleanup()

with tempfile.TemporaryDirectory(prefix='terminal-review-pty-') as folder:
    root = Path(folder)
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.name', 'PTY Test')
    git(root, 'config', 'user.email', 'pty@example.invalid')
    git(root, 'config', 'commit.gpgsign', 'false')
    (root / 'sample.txt').write_text('before\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'First')
    git(root, 'update-ref', 'refs/remotes/origin/main', git(root, 'rev-parse', 'HEAD').decode().strip())
    (root / 'sample.txt').write_text('local\n')
    git(root, 'add', 'sample.txt')
    git(root, 'commit', '-m', 'Local')
    (root / 'sample.txt').write_text('working\n' * 100)
    for width, exit_key in [(140, b'q'), (80, b'\x03'), (40, b'q')]:
        session(root, width, exit_key)

    def png(rgb):
        def chunk(name, data):
            return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))
        header = struct.pack('!2I5B', 12, 8, 8, 2, 0, 0, 0)
        data = (b'\x00' + bytes(rgb) * 12) * 8
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(data)) + chunk(b'IEND', b'')
    (root / 'image.png').write_bytes(png((255, 0, 0)))
    git(root, 'add', 'image.png')
    git(root, 'commit', '-m', 'Image')
    (root / 'image.png').write_bytes(png((0, 255, 0)))
    for width in [140, 80, 40]:
        session(root, width, b'q', image=True)
