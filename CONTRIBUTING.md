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

## Publishing a release (maintainers)

Run these commands from the project root. Before the first publication, check that the name is available with `npm view diffora name --registry=https://registry.npmjs.org`. A network error does not establish availability.

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm publish --access public
```

`prepublishOnly` repeats type checking, tests and compilation before publication. Inspect the package contents before publishing; the package includes compiled code, skills, documentation and the MIT license. Never commit npm credentials. Complete authentication and any two-factor prompt in your own terminal.

After publishing, verify the release with `npm view diffora version` and test installation in a clean environment. Change the README release status only after confirming publication. Each subsequent release needs a new version; npm does not allow replacing an existing name/version. Coordinate the Git tag and changelog with that release.
