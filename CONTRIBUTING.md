# Contributing to Diffora

Open an issue before substantial new features so their scope can be discussed. Small fixes and documentation improvements can go straight to a pull request.

## Setup

Fork and clone the repository, use Node.js 22.13+ and install with `npm ci`. Run `npm run dev -- --repo /path/to/repo` to develop the CLI.

## Focused changes

- Keep Git review read-only; store application state outside the reviewed repository.
- Keep Git execution in `src/git/`, with separate arguments and no shell.
- Preserve keyboard navigation, narrow layouts, cancellation and terminal cleanup.
- Add meaningful tests for behavior changes. Integration fixtures must use temporary repositories.
- Update the README or Spanish guide when usage or limitations change.

## Before a pull request

```sh
npm run typecheck
npm test
npm run build
```

For input, layout, lifecycle or workflow changes, also run `npm run test:terminal` and `npm run test:workflow` on macOS/Linux with Python 3. Describe what changed, why, how it was verified, and any remaining limitations. Include terminal dimensions and reproduction steps for UI issues. Keep credentials, private code and private review notes out of reports.

Contributions are provided under the project's MIT license.
