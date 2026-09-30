# Launcher version (PACK-09)

## Canonical source

Edit **exactly one place** to bump the Launcher product version:

`package.json` → `"version"` (root)

Current example: `0.6.0-rc.18`

Then run:

```bash
pnpm version:generate
pnpm version:check
```

`pnpm build` and `pnpm desktop:package:prepare` run generate+check automatically.

## Generated metadata

Tracked SemVer modules (DO NOT EDIT by hand) — **commit-stable SoT** derived from `package.json` version:

- `src/version.generated.ts`
- `desktop/shared/version.generated.ts`

Also synced by `version:generate`:

- root `package.json` → `shortVersion` / `shortVersionWindows` (Windows PE numeric)
- `ui/package.json` → `version` (synced copy only; not an independent product source)
- `electron-builder.yml` → `buildVersion`

### Build provenance (`build.generated.ts`)

Tracked bootstrap modules (DO NOT EDIT by hand):

- `src/build.generated.ts`
- `desktop/shared/build.generated.ts`

These embed **git HEAD** (`LAUNCHER_BUILD_COMMIT` / `buildId`). They are **not** commit-stable:
regenerating then committing always makes the *next* HEAD look stale (self-reference).

`pnpm version:check` **refreshes** build provenance from the checked-out HEAD before verifying.
`pnpm version:generate`, `pnpm build`, and package prepare also regenerate them.

Packaged / player-release builds must still fail-closed on `LAUNCHER_BUILD_DIRTY = false`
and commit match for the ref actually being built.

## Windows mapping

Policy: `PHASE_BLIND_NUMERIC_N`

| SemVer | Windows PE |
|--------|------------|
| `X.Y.Z` | `X.Y.Z.0` |
| `X.Y.Z-rc.N` | `X.Y.Z.N` |
| `X.Y.Z-beta.N` | `X.Y.Z.N` |
| `X.Y.Z-alpha.N` | `X.Y.Z.N` |

Example: `0.6.0-rc.18` → `0.6.0.18`

`alpha.N`, `beta.N`, and `rc.N` share the same numeric PE version. Artifact SemVer names/tags remain the distribution identity. Do not reuse `N` across phases for the same `X.Y.Z` if PE uniqueness matters.

## Build provenance dirty-state

`buildId` is `${semver}@${shortCommit}` with optional `+dirty`.

Dirty means **product/build-input** worktree dirt, not arbitrary local evidence:

| Porcelain | Dirty? |
|-----------|--------|
| Tracked modify/delete/rename of product/source/config/tests/scripts | yes |
| Untracked product/source/config/test/script/package paths | yes |
| Untracked / changed `docs/audits/**` only (local audit evidence) | **no** |
| Canonical `version:generate` outputs only (`*.generated.ts` version/build twins) | **no** |
| Ignored `dist` / `release` / logs (absent from porcelain) | no |

Not a broad `docs/**` exclusion. Classification: `isWorktreeProductDirtyFromPorcelain` in `scripts/version/lib.mts`.

Components must be ≤ 65535; out-of-range values fail generation (no silent truncation).

Unsupported prerelease shapes (e.g. `0.6.0-preview.1`, `0.6.0-rc`) fail deterministically.

## Consumers

| Surface | Source |
|---------|--------|
| CLI / core | `LAUNCHER_VERSION` from `src/version.ts` → generated |
| Desktop Main / diagnostics | `DESKTOP_PRODUCT_VERSION` from `desktop/shared/product.ts` → generated |
| Angular UI | imports `@sweetcraft/product` → generated |
| Installer filename | electron-builder `${version}` = SemVer |
| PE FileVersion / ProductVersion | `shortVersion` / `shortVersionWindows` / `buildVersion` = Windows mapping |

## Windows PE branding vs Authenticode

`package.json` `author.name` drives electron-builder PE **CompanyName** (PACK-12C).

Current unsigned branding (product only, not a legal entity / not Authenticode):

`SweetCraft / XBASE`

This overwrites the stock Electron inheritance (`GitHub, Inc.`). It does **not** claim a verified Windows publisher.

### Optional gate

`SWEETCRAFT_REQUIRE_LEGAL_IDENTITY=1` on `pnpm version:check` fails if `author.name` is missing.

Signed Authenticode publisher CN (PACK-11, deferred) is a separate decision and must not be invented here.
