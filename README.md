# Diffora

**Review what changed. Stay in your terminal.**

Diffora is a local Git review tool built with TypeScript, React and Ink. Browse commits, inspect pending changes, preview images, and keep track of what you have reviewed. Designed for the review step after working with a coding agent, it also works with changes you wrote yourself.

Git access is read-only: Diffora does not stage, commit, check out or push. Notes and progress are stored outside the reviewed repository. No account, server or AI service is required.

[Guía en español](docs/usage.es.md) · [Contributing](CONTRIBUTING.md) · [Issues](https://github.com/JoseMLuzu/diffora/issues) · [MIT license](LICENSE)

## Features

- Browse the latest 30 commits with hash, title and date; highlight commits absent from locally known upstream history with `↑`.
- Review unstaged, staged and untracked files separately, including deletions and renames.
- Switch between unified and side-by-side diffs, with line numbers, hunk navigation and highlighted changes.
- Preview PNG, JPEG, WebP, GIF, TIFF and AVIF changes and toggle the previous/new image.
- Search paths, filter unfinished files, and mark files as done or needing another review.
- Persist notes and review progress; revisit outstanding tasks and export Markdown reports.
- Open the current working-tree file at a diff line in VS Code, Cursor or a configured editor.
- Navigate with the keyboard, use a single panel in narrow terminals, or drag panel borders in wide terminals.
- Optionally launch from Claude Code or Codex; use plain text mode without a TTY.

## Install from npm

The first npm release is being prepared. Once `diffora@0.1.0` is published, install it with:

```sh
npm install --global diffora
diffora
```

Until the release is available, use the source installation below. Node.js 22.13+ and Git are required.

## Install from source

Requirements: **Node.js 22.13+** (Node 24 recommended), npm, Git on PATH and an interactive terminal. Python 3 is needed only for PTY tests. Keep npm optional dependencies enabled: Sharp uses native optional packages.

```sh
git clone https://github.com/JoseMLuzu/diffora.git
cd diffora
npm ci
npm run build
npm install --global .
```

Run inside any Git repository:

```sh
cd /path/to/your-project
diffora
# Or select another repository, including paths with spaces:
diffora --repo "/path/to/my project"
```

Global installation needs a writable npm prefix. Without it, run `node /path/to/diffora/dist/cli.js --repo /path/to/project`.

`terminal-review` remains a compatibility alias. Rebuild a linked source installation after updating it; reinstall globally if command mappings changed.

## First review

1. Press `h` for history or `w` for pending changes.
2. Select a commit/category with ↑/↓ and press Enter.
3. Select a file and press Enter to browse its diff.
4. Press `m` when finished, or `n` if it needs another review. Use `c` to add a note.
5. Press `f` to focus on unfinished files, or `t` to revisit tasks.
6. Press `q` to save and exit; `?` shows keyboard help.

Normal commits compare with their parent, the initial commit with the empty tree, and merges with their first parent. Pending categories compare working tree → index, index → HEAD, and untracked files shown as added content.

Push labels use local upstream/remote-tracking refs. Diffora never fetches or checks GitHub live. Update refs yourself when needed, then press `r`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| ↑ / ↓ | Select an item or scroll |
| Enter | Open selection / next panel |
| Tab / Shift+Tab | Next / previous panel |
| Esc | Go back, clear a file filter, or cancel editing |
| h / w / r | History / pending changes / refresh |
| / | Search file paths; Enter applies, Ctrl+U clears input |
| m / n | Toggle done (green) / needs review (orange) |
| c | Edit a note; Enter saves, Esc cancels |
| f / ] | Filter unfinished files / next unfinished file |
| j / k | Next / previous diff hunk |
| s | Unified / side-by-side text diff |
| v | Previous / new image |
| e | Open current file in the configured editor |
| t / i | Outstanding tasks / review summary |
| E | Export a Markdown report |
| ? | Help |
| q / Ctrl+C | Save and exit; Ctrl+C can exit after a save failure |

Below 110 columns, one panel is displayed at a time. Side-by-side diffs require 80 columns. Drag vertical borders to resize panels in wide terminals with SGR mouse reporting. The original screen and terminal settings are restored on exit.

## Coding-agent integration

```sh
diffora --install-skills
```

Restart your agent if necessary. Invoke **`$diffora` in Codex** or **`/diffora` in Claude Code**. Skills are installed under `~/.agents/skills/` and `~/.claude/skills/`; customized instructions are preserved.

The default action, `diffora --open`, opens a separate Terminal.app window on **macOS**. It does not embed the viewer in chat or take over the agent's keyboard. A sandbox may block application launch; run the CLI yourself in that case. The regular CLI and text mode do not require macOS; PTY tests target macOS/Linux.

For explicit text review inside a conversation or script:

```sh
diffora --text
diffora --text --source staged --file 1
diffora --text --commit abc1234 --file 1 --offset 80 --limit 80
```

Files are numbered from 1, offsets from 0. Commit-prefix selection in text mode is limited to the latest 30 commits. `--help` lists all options.

## Progress and configuration

Marks, notes and preferences persist per repository. Pending reviews are checked against content fingerprints when reopening, refreshing and during periodic checks. Changed content loses its mark; its note remains as stale. Commit reviews are tied to their hash.

| Variable | Purpose |
| --- | --- |
| `DIFFORA_STATE_DIR` | Progress/export directory, outside the reviewed repository |
| `XDG_STATE_HOME` | Default state base; otherwise `~/.local/state` |
| `DIFFORA_EDITOR` | Editor command, default `code`; supports `{file}`, `{line}`, `{column}` |

For compatibility, the state subdirectory is still `terminal-review`. Legacy `TERMINAL_REVIEW_STATE_DIR` and `TERMINAL_REVIEW_EDITOR` variables remain supported.

```sh
DIFFORA_EDITOR="cursor --reuse-window" diffora
```

The editor opens the **current working-tree file**, even when reviewing historical changes; line numbers may not match it. Notes/reports contain local review information. See the [Spanish guide](docs/usage.es.md) for persistence failures, concurrent viewers and detailed workflows.

## Development

```sh
npm ci
npm run dev -- --repo /path/to/test-repo
npm run typecheck
npm test
npm run build
npm run test:terminal
npm run test:workflow
```

Integration tests use temporary repositories. Coverage includes parsing, initial/merge commits, staged/unstaged/untracked files, deleted and renamed paths, binaries, images, push status, race protection and persistence. Python PTY tests exercise navigation, mouse resizing, screen restoration and review workflows at 40, 80 and 140 columns.

| Location | Responsibility |
| --- | --- |
| `src/cli.ts` | Arguments and process lifecycle |
| `src/ui/` | Ink components, input and terminal layout |
| `src/application/` | Reducer, coordination, progress, reports and launchers |
| `src/core/` | Models, diff and progress parsing |
| `src/git/` | Git execution, queries and fingerprints |
| `src/images/` | Bounded decoding and terminal rasterization |

The UI never runs Git directly. Git is spawned with separate arguments and `shell: false`; pagers, external diff tools and textconv are disabled. Paths use NUL delimiters, controls are neutralized, and stale asynchronous results are rejected.

## Current limitations

- Text diffs: 1 MiB / 10,000 lines, with a truncation warning. List queries: 8 MiB. Git processes: 15 seconds.
- Image versions: 10 MiB / 16 megapixels; thumbnails up to 160×160 pixels. Animation shows its first frame. SVG is text; other binaries show a notice.
- Pending fingerprints: 64 MiB and 10 seconds per read. Files that cannot be validated cannot be marked reviewed.
- No horizontal scrolling or content search. Long lines are clipped; UTF-8 filenames/content are expected.
- Combined conflict hunks are not parsed as ordinary diffs. Submodules show reference changes rather than nested history.
- Local remote refs may be stale. Periodic reads are not an atomic snapshot of concurrent edits.
- Progress is local, without cross-machine sync. Notes are per file/source. Review marks are human decisions, not guarantees of correctness.

## Contributing and license

Bug reports, focused improvements and documentation contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and checks.

Diffora is available under the [MIT license](LICENSE).
