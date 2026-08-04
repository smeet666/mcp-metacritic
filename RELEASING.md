# Releasing

Releases are published to npm by GitHub Actions using npm **trusted publishing**
(OIDC). There is no npm token stored on this repository.

## One-time setup

Trusted publishing is configured from a package's settings page, so it cannot be
used for the very first publish of a package that does not exist yet. The first
release goes out from a workstation; everything after that goes out from CI.

### 1. Publish the first version manually

```bash
npm login --auth-type=web   # opens a browser, covers 2FA including passkeys
npm publish --access public # prepublishOnly reruns typecheck, tests and build
```

If the account requires two-factor authentication on writes and the second
factor is a security key rather than an authenticator app, the CLI cannot
prompt for it. Use a recovery code from the account's 2FA settings:
`npm publish --access public --otp=<recovery-code>`.

### 2. Register the trusted publisher

On npmjs.com, open the package, then **Settings** and the **Trusted Publisher**
section. Every field is case-sensitive and must match this repository exactly:

| Field                | Value            |
| -------------------- | ---------------- |
| Publisher            | GitHub Actions   |
| Organization or user | `smeet666`       |
| Repository           | `mcp-metacritic` |
| Workflow filename    | `publish.yml`    |
| Environment          | leave empty      |

### 3. Revoke anything used to bootstrap

Any token or recovery code used for the first publish should be revoked once
trusted publishing works, since it is no longer needed.

## Every release after that

1. Bump the version in **four** places, which must stay in step:
   - `package.json`
   - `package-lock.json`, whose root `version` field is easy to forget by hand
   - `server.json` (twice: the top-level `version` and the package `version`)
   - `src/version.ts`, which feeds the User-Agent sent to Metacritic

   `npm version patch --no-git-tag-version` covers the first two together, which
   is why it is preferred over editing `package.json` directly.

2. Update `CHANGELOG.md`.
3. Commit, then tag and push:

```bash
npm version patch --no-git-tag-version   # package.json + package-lock.json
# then edit server.json and src/version.ts to match
git commit -am "Release v1.0.1"
git tag v1.0.1
git push origin main --tags
```

The `publish.yml` workflow reruns typecheck, tests and build, then publishes
with `--provenance`, which links the published tarball to the exact commit and
workflow run that produced it.

## Verifying a release

```bash
npm view mcp-metacritic version
npx -y mcp-metacritic          # should start and wait on stdin
```

The npm package page should show a provenance badge pointing at the workflow run.

Note that publishing is permanent: a version can only be unpublished within 72
hours, and the name stays reserved afterwards.

## Listing on the MCP registry

`server.json` at the repository root is ready for the official MCP registry.
Once the package is on npm, publish the listing with the `mcp-publisher` CLI,
which authenticates against GitHub and matches the `mcpName` field in
`package.json` against the repository to prove ownership.

```bash
mcp-publisher login github -token "$(gh auth token)"
mcp-publisher publish
```

## The live canary

`live-canary.yml` runs the live suite nightly and opens an issue when it fails.
It matters more here than for a documented API: Metacritic publishes no API
documentation and makes no compatibility promise, so the response shapes this
server reads can change without notice, and the unit tests run on generated
fixtures that would stay green while the published server is broken.
