# PACK-12H.1 — HUMAN RC qualification closure + pre-tag gate

**Date:** 2026-09-22  
**STATUS / VERDICT:** **READY_TO_TAG**  
**CURRENT HEAD = origin/main = QUALIFIED TAG TARGET:**  
`c203dc0f077235b430bf200327fdcea3ea5aa542`  
**Proposed tag:** `v0.6.0-rc.18` (not created)  
**NO TAG / RELEASE / PUBLISH / DEPLOY** (this lot)

## Governance

| Check | Result |
|-------|--------|
| Fresh `git fetch` | OK |
| HEAD == origin/main == expected | OK |
| Tracked mutations | **none** (WIP = untracked `docs/audits/**` only) |
| SemVer `package.json` | `0.6.0-rc.18` |
| Tag `v0.6.0-rc.18` local | **absent** |
| Tag `v0.6.0-rc.18` remote | **absent** |

This audit is intentionally **WIP / untracked** so the qualified product commit remains `c203dc0` (docs/audits do not dirty provenance).

## Qualified candidate (exact CI bytes)

| Field | Value |
|-------|--------|
| Source | player-release workflow_dispatch **35747967194** |
| Commit | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| Build ID | `0.6.0-rc.18@c203dc0f0772` |
| Filename | `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` |
| Size | `85858329` bytes |
| SHA-256 | `17805095125902b2e9d48a0c4c5ce5fd986dd873ee0088c00d6410e6f7dddd27` |
| dirty | `false` |
| signing | `unsigned` |

Automated companion: CI Main **35747448126** SUCCESS at same commit.

## HUMAN_VERIFIED (Kevin, `kevin\sweetcraft-e2e`)

| ID | Result | Evidence summary |
|----|--------|------------------|
| **H1** | PASS | Actions artifact downloaded; local size + SHA-256 exact match |
| **H2** | PASS | Install + start on isolated standard account; diagnostics Version/Build ID/commit/OS/production/packaged match; Auth SIGNED_OUT; Install NOT_INSTALLED; no last errors |
| **H3** | PASS | PACK-12D AppData marker + custom-instance marker preserved; path `C:\Users\Public\SweetCraft-E2E\custom-instance-D-empty` |
| **H4** | PASS | Running-app install-over: NSIS close dialog → accept → install OK → relaunch Build `0.6.0-rc.18@c203dc0f0772` |

### Scope limit (not re-tested on this candidate)

- Microsoft live authentication  
- Complete pack download/install  
- Minecraft launch/gameplay  
- Windows uninstall  
- Downgrade  

Prior PACK-12D HUMAN covers install-over / uninstall / AppData / custom instance semantics where applicable; this lot qualifies the **exact c203dc0 CI candidate** for identity, start, preservation, and running-app NSIS behavior only.

## player-release pre-tag contract @ c203dc0

| Requirement | Status |
|-------------|--------|
| Trigger `push: tags: v*` | OK |
| `desktop:package` → `--publish never` | OK (`package.json`) |
| Order: version:check → build → test → package → smoke → provenance → manifest → body | OK |
| `LAUNCHER_BUILD_DIRTY = false` + commit match | OK (fail-closed) |
| Release step only `if: github.ref_type == 'tag'` | OK |
| `draft: true`, `make_latest: false`, prerelease when tag contains `-` | OK |
| `workflow_dispatch` without tag → artifacts only, no Release | OK |

## Tag rebuild semantics

Tagging **exactly** `c203dc0f077235b430bf200327fdcea3ea5aa542` as `v0.6.0-rc.18` will:

1. Checkout that commit (clean tree).  
2. Rebuild/package with expected provenance `buildId=0.6.0-rc.18@c203dc0f0772`, `dirty=false`.  
3. Enforce SemVer tag ↔ `0.6.0-rc.18`.  
4. Create a **draft** GitHub Release only (human publish still required).

**Byte note:** NSIS setup SHA-256 of the **new** tag-built artifact may differ from the HUMAN-verified dispatch bytes (`17805095…`) due to packaging non-determinism. Operator must re-hash the **draft Release** assets before publish. Source/provenance identity remains the same qualified commit.

## Exact proposed operator action (NOT executed)

```text
git tag -a v0.6.0-rc.18 c203dc0f077235b430bf200327fdcea3ea5aa542
git push origin v0.6.0-rc.18
→ inspect draft Release → independent SHA-256 → HUMAN publish
```

## Remaining blockers before public players

1. Human publish of draft (after tag).  
2. Re-verify SHA-256 of **Release** assets (not only dispatch artifact).  
3. Optional: GitHub Environment `player-release` required reviewers.  
4. Out-of-scope matrix (auth/pack/play) not re-run on this candidate — accept residual risk or schedule later smoke.

## Explicit

**NO TAG / RELEASE / PUBLISH / DEPLOY** performed by PACK-12H.1.