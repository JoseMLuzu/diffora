# Diffora

[![CI](https://github.com/JoseMLuzu/diffora/actions/workflows/ci.yml/badge.svg)](https://github.com/JoseMLuzu/diffora/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/diffora.svg)](https://www.npmjs.com/package/diffora)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Review Git changes in your terminal, especially after working with coding agents.**

Diffora gives you one place to inspect commits, pending changes, code diffs, and images before you move on. It also remembers what you have reviewed. Git operations are read-only; review progress stays outside your repository. No account, server, or AI service is required.

[Español](docs/usage.es.md) · [Contributing](CONTRIBUTING.md) · [Report an issue](https://github.com/JoseMLuzu/diffora/issues)

![Diffora showing commit history, changed files, and a color-coded diff in three terminal panels](assets/terminal-panel.svg)

## Why Diffora?

- **See the whole change:** browse the latest 30 commits, staged and unstaged changes, and untracked files. An `↑` highlights commits missing from locally known upstream history.
- **Inspect code and images:** switch between unified and side-by-side diffs, jump between change blocks, and preview common image formats before and after a change.
- **Keep your place:** mark files done or needing another look, add notes, filter unfinished work, and export a Markdown report.
- **Stay in control:** use the keyboard and review on narrow terminals. Diffora itself makes no Git or repository changes.

## Quick start

Requires Node.js **22.13+**, npm, Git, and an interactive terminal.

```sh
npm install --global diffora
cd /path/to/your-project
diffora
```

From another directory, run `diffora --repo "/path/to/your project"`. A project-local `npm install diffora` uses `npx diffora` instead of the bare command. Run `diffora --version` to check a global installation.

On your first run, press `w` for pending changes or `h` for commit history. Use ↑/↓ and Enter to open a category or commit, then a file. Press `?` for help and `q` to save and exit.

If a global install reports `EEXIST` for `terminal-review`, an older global alias is occupying that command. Run `npm uninstall --global terminal-review`, then retry `npm install --global diffora`. In zsh, run `rehash` if the command is still missing.

## What you can review

| Source | Comparison |
| --- | --- |
| History | Each commit against its parent; a merge against its first parent; the first commit against an empty tree |
| Unstaged | Working tree against the index |
| Staged | Index against `HEAD` |
| Untracked | New files shown as added content |

Deleted and renamed files are included. The unpushed `↑` indicator reads **local remote-tracking refs**; Diffora does not fetch, so press `r` after your usual fetch or push to refresh the view.

Text diffs include old/new line numbers and highlighted additions and deletions. Press `s` to switch to a side-by-side view (80 columns or wider). Supported images—PNG, JPEG, WebP, GIF, TIFF, and AVIF—show a terminal preview; press `v` to compare versions. Other binary files show a notice.

![Diffora's expanded side-by-side diff with previous code on the left and new code on the right](assets/side-by-side-diff.svg)

## Essential controls

The bottom bar shows keys relevant to the active panel. Press `?` for the complete, task-grouped guide.

| Keys | Action |
| --- | --- |
| ↑/↓, Enter, Tab, Esc | Move, open, switch panel, go back |
| `h` / `w` / `r` | History / pending changes / refresh |
| `/` | Search file paths |
| `m` / `n` / `c` | Mark done / needs review / add a note |
| `f` / `]` | Show unfinished files / jump to the next one |
| `j` / `k` / `s` / `v` | Change block navigation / side-by-side diff / image version |
| `t` / `i` / `E` | Tasks / summary / export report |
| `q` / Ctrl+C | Save and exit |

Below 110 columns, Diffora shows one panel at a time. On wide terminals, drag panel borders to resize them. Press `e` to explicitly open the current working-tree file in your editor; it may differ from the historical version being reviewed.

## Use it with Codex or Claude Code

Install the chat skills once with `diffora --install-skills` after installing Diffora globally. Use **`$diffora` in Codex** or **`/diffora` in Claude Code**; restart the agent if the command does not appear.

On macOS, the skill opens the interactive viewer in a **separate Terminal.app window**. Press `q` there to return to the chat. You can also open it yourself with `diffora --open --repo "/path/to/your project"`. For a plain-text response in chat or a script, run `diffora --text`; see `diffora --help` for source, commit, file, and pagination options.

## Language and local progress

Diffora detects your device's preferred language at startup: Spanish for Spanish locales, English otherwise. Override it for one run with `DIFFORA_LANG=es diffora` or `DIFFORA_LANG=en diffora`. This changes the interface, help, text mode, and reports, but never translates file contents or commit messages.

Marks, notes, view preferences, and exports are stored per repository under `~/.local/state/terminal-review/` (or `$XDG_STATE_HOME/terminal-review/`), outside the reviewed repository. Pending-file marks are cleared when the underlying change changes; notes remain available for another review. Set `DIFFORA_STATE_DIR` to use another location. Set `DIFFORA_EDITOR` to choose an editor; it defaults to `code`.

## Develop

```sh
git clone https://github.com/JoseMLuzu/diffora.git
cd diffora
npm ci
npm run dev -- --repo /path/to/test-repo
npm run typecheck
npm test
npm run build
```

The CLI is TypeScript; Ink renders the terminal UI, and Git commands live in `src/git/`. For interactive terminal tests, run `npm run test:terminal` and `npm run test:workflow` with Python 3 installed. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and release guidance.

## Limits

- Text diffs are capped at **1 MiB / 10,000 lines**; image versions at **10 MiB / 16 megapixels**. Diffora warns when content is truncated or cannot be previewed. Animated images show the first frame.
- Long lines are clipped to the terminal width; file-content search and horizontal scrolling are not available. SVG is treated as text, and other non-image binaries show a notice.
- Unpushed status depends on local refs and can be stale until you fetch. Review marks are your decisions, not a correctness guarantee.

For more detailed usage and troubleshooting, see the [Spanish guide](docs/usage.es.md). Diffora is released under the [MIT license](LICENSE).
