# PACK-11A — Windows Signing Implementation Readiness Audit

**Date:** 2026-09-18  
**Mode:** READ-ONLY (no source / GitHub / Azure mutation)  
**STARTING_HEAD:** `aeb32b35051f1a2798c5d83ea090470270053b27`  
**origin/main:** `aeb32b35051f1a2798c5d83ea090470270053b27` (match — OK)  
**Product:** SweetCraft Launcher `0.6.0-rc.18`  
**Toolchain:** Electron 35.7.5 · electron-builder / app-builder-lib **26.15.3** · NSIS x64 user-scope  

---

## 1. Current release / signing inventory

### Packaging surface

| Item | Evidence | Signing today |
|------|----------|---------------|
| `electron-builder.yml` | `appId fr.xbase.sweetcraft.launcher`, `productName`/`executableName` SweetCraft Launcher, `copyright` set, **no** `win.azureSignOptions`, **no** `win.signtoolOptions`, `publish: null` | Unsigned path only |
| Scripts | `desktop:package` → prepare + `electron-builder --win --x64` | Local/CI unsigned |
| Output dir | `release/` (gitignore) | Artifacts local/CI only |
| Artifact names | Setup: `${productName}-${version}-win-${arch}-setup.${ext}` → `SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe` | — |
| NSIS | `oneClick: false`, `perMachine: false`, `allowElevation: false`, shortcuts on, `deleteAppDataOnUninstall: false` | Builder still ships `elevate.exe` helper |
| Provenance | `pnpm version:generate` / `version:check`; `LAUNCHER_BUILD_*` | Clean package uses `dirty=false` |
| Legal gate | `SWEETCRAFT_REQUIRE_LEGAL_IDENTITY=1` → requires `package.json` `author` | **Unset** in CI; `author` **absent** |
| Checksums / release tooling | electron-builder `.blockmap` only; **no** release checksum manifest / `gh release` workflow | — |
| Secrets in repo | `.gitignore` blocks `*.p12`/`*.pfx`; workflows declare **no secrets** | — |

### PE / identity debt (live unsigned package)

| Field | Current value | Notes |
|-------|---------------|-------|
| CompanyName | `GitHub, Inc.` | Inherited Electron default — **incorrect** for SweetCraft; do **not** invent replacement |
| LegalCopyright | `Copyright © SweetCraft / XBase` | From `electron-builder.yml` `copyright` |
| ProductName / FileDescription | SweetCraft Launcher | OK |
| FileVersion / ProductVersion | `0.6.0.18` | Windows mapping OK |
| Authenticode | `NotSigned` on setup + main EXE | Confirmed |
| In-app UI publisher copy | “Maidenhead” (`settings.about.publisher_value`) | **Marketing/UI string** — not PE/Authenticode publisher |

### GitHub Actions (PACK-10)

| Workflow | Trigger | Runner | Permissions | Package | Release |
|----------|---------|--------|-------------|---------|---------|
| `ci-pr.yml` | `pull_request` → main | `windows-latest` | `contents: read` | No | No |
| `ci-main.yml` | `push` → main | `windows-latest` | `contents: read` | **Unsigned** `desktop:package` + smoke | **No** — uploads artifact `sweetcraft-launcher-main-unsigned` 7d |

- No `id-token: write`, no environments, no tag triggers, no draft/public releases.
- Accidental public release via current workflows: **low** (artifact ≠ Release; `publish: null`).
- Documented out-of-scope: signing, Trusted Signing, OIDC, legal identity gate (`docs/CI.md`).

---

## 2. Windows artifact signing matrix

Observed under `release/win-unpacked` + setup (local G.6.2E package; same layout CI produces).

| Artifact | Role | Authenticode now | Classification | Rationale |
|----------|------|------------------|----------------|-----------|
| `SweetCraft Launcher-*-win-x64-setup.exe` | NSIS installer (primary distribute) | NotSigned | **MUST sign** | User-facing download; SmartScreen |
| `SweetCraft Launcher.exe` | Main app EXE | NotSigned | **MUST sign** | Primary process; PE identity surface |
| NSIS `__uninstaller.exe` (build intermediate / embedded) | Uninstaller | Produced during package (builder signs when signing enabled) | **MUST sign** when toolchain emits it | electron-builder signing logs include uninstaller when signing on |
| `resources/elevate.exe` | NSIS elevation helper (Johannes Passing) | NotSigned | **SHOULD NOT re-sign** as SweetCraft first-party / treat carefully | Third-party binary; re-signing with SweetCraft cert misattributes origin. Prefer vendor-signed helper or leave as shipped by builder; confirm policy with legal. |
| `d3dcompiler_47.dll` | Graphics | Valid — Microsoft | **Third-party already signed — do not re-sign** | Microsoft Authenticode present |
| `ffmpeg.dll`, `libEGL.dll`, `libGLESv2.dll`, `vk_swiftshader.dll`, `vulkan-1.dll` | Electron/Chromium runtime | Mixed NotSigned in this tree | **SHOULD NOT re-sign** as first-party (default) | Electron-shipped; signing all Electron DLLs is unusual and can break updates. Optional later policy: **UNKNOWN** whether Electron 35 redistributables should be left as-is vs vendor-signed baseline — defer to Electron packaging norms + threat review. |
| `app.asar` | App payload | N/A (not PE) | **Should not sign as EXE** | Integrity via asar + installer signature |
| `*.blockmap` | Update delta map | N/A | Recompute **after** signed installer | Hash changes if installer re-signed |
| Future updater helper EXE | Not present | — | **UNKNOWN** until updater lot | No first-party updater binary in current package |

**No first-party child EXEs** besides main launcher in current ship set.

---

## 3. electron-builder 26.15.3 signing findings

Evidence: installed `app-builder-lib@26.15.3` `scheme.json` + `winPackager.js` / `windowsSignAzureManager.js`.

### Native capabilities (this version)

1. **`win.azureSignOptions`** → Azure Trusted Signing (`WindowsAzureSigningConfiguration`)  
   Required fields: `publisherName`, `endpoint`, `codeSigningAccountName`, `certificateProfileName`  
   Default RFC3161 TSA: `http://timestamp.acs.microsoft.com`  
   Mutually exclusive with `signtoolOptions` (schema: cannot use both; Trusted Signing wins if azure configured).

2. **`win.signtoolOptions`** → classic OV/EV via signtool / `@electron/windows-sign`  
   Supports `certificateSha1` / `certificateSubjectName`, `signingHashAlgorithms`, `rfc3161TimeStampServer` (default DigiCert), optional `sign` custom hook path, `signExts`.

3. **`forceCodeSigning`** — fail build if signing does not occur.

4. **`signAndEditExecutable` / `signExecutable`** — control PE resource edit + sign of app EXE before NSIS.

5. **Order (actual builder flow):**  
   clean build outputs → pack `win-unpacked` → **sign/edit main executable** (`signApp`) → NSIS packages signed app tree → **sign setup (+ uninstaller artifacts as builder does)** → emit `.blockmap`.  
   Custom `afterSign` (if used) sits in the app-signing phase before outer installer completion — confirm hook timing in implementation lot against 26.15.3 docs.

6. **Timestamp:** SHA-256 digest signing + RFC3161 via azure defaults or `rfc3161TimeStampServer` for signtool path.

### Trusted Signing + OIDC (external verification required)

- electron-builder docs support Trusted Signing via `azureSignOptions` + Entra env credentials (`EnvironmentCredential`).
- Open issue history (`electron-builder#9623` / PR `#9687`): older Azure manager **preflight rejected pure OIDC / DefaultAzureCredential** unless `AZURE_CLIENT_SECRET` (or cert/username) set.
- **UNKNOWN for 26.15.3 without lab proof:** whether OIDC-only (`azure/login` federated token) works without long-lived client secret.
- **Contingency (still preferred security model):**  
  - Path T1: `azureSignOptions` if OIDC lab proves OK on 26.15.3; else  
  - Path T2: `azure/login` (OIDC) + **custom sign** (`Azure/trusted-signing-action` or signtool + Azure Code Signing DLib) invoked via `signtoolOptions.sign` / staged script — avoids long-lived PFX; still no private key in GitHub secrets.

Do **not** treat blog posts as authoritative until a dry-run on this repo’s builder version passes.

---

## 4. GitHub workflow findings

| Finding | Detail |
|---------|--------|
| No signing workflow | Only CI validate + unsigned package on main |
| Permissions minimal | `contents: read` only — correct for current scope |
| No protected environments | `windows-release` **does not exist** (config prerequisite) |
| Artifact upload | Unsigned installer only; retention 7d; not a Release |
| Fork / PR risk | PR cannot package; no secrets on PR — good |
| Accidental publish | No tag→release automation; STOP condition if anyone adds `softprops/action-gh-release` without draft+environment gates |
| Windows runner | Already available — good for Trusted Signing / signtool |

---

## 5. Preferred architecture — Microsoft Trusted Signing

```
tag / workflow_dispatch (release managers only)
  → job on windows-latest
  → environment: windows-release (required reviewers + wait timer optional)
  → permissions:
       contents: write   # draft release only
       id-token: write   # OIDC
       actions: read
  → checkout @ exact tag SHA
  → pnpm install frozen + version:check with SWEETCRAFT_REQUIRE_LEGAL_IDENTITY=1
  → clean package (dirty=false; buildCommit=tag)
  → authenticate Azure via OIDC (azure/login federated credential → env windows-release)
  → sign via azureSignOptions OR custom Trusted Signing action (per lab proof)
  → verify Authenticode matrix (section 8)
  → write SHA-256 manifest AFTER signing (+ blockmap refresh if needed)
  → upload artifacts + create GitHub Release --draft
  → STOP: human publish gate (no auto-latest)
```

### Required GitHub permissions / protections (not created)

- Environment `windows-release`: required reviewers; restrict to `main` tags / selected branches; no self-approve if policy requires.
- Federated credential on Entra app: subject `repo:<org>/<repo>:environment:windows-release` (exact syntax per Microsoft docs — verify at setup).
- Repo vars (non-secret): Trusted Signing endpoint, account name, certificate profile name, expected publisher CN.
- **Avoid** storing PFX/private keys. Prefer no `AZURE_CLIENT_SECRET` if OIDC path proven.

### External prerequisites (C) — UNKNOWN until human confirms

- Azure subscription + Trusted Signing account + certificate profile identity  
- Legal org identity accepted by Microsoft for Trusted Signing enrollment  
- Entra app registration + role `Trusted Signing Certificate Profile Signer`  
- Whether SweetCraft/XBase/Maidenhead entity is the **certificate subject** — **UNKNOWN / legal**

---

## 6. Fallback architecture — OV + compliant HSM/cloud CA

| Aspect | Preferred (Trusted Signing) | Fallback (OV/HSM) |
|--------|----------------------------|-------------------|
| Key custody | Microsoft cloud HSM | CA/HSM vendor (must not be exportable software PFX in Actions if avoidable) |
| electron-builder | `win.azureSignOptions` | `win.signtoolOptions` (+ CSC_* or cert SHA1 from token/HSM) |
| Auth | OIDC federated | Often long-lived secret or hardware token bridge — higher theft risk |
| Timestamp | ACS RFC3161 default | DigiCert (or CA) RFC3161 |
| SmartScreen reputation | Generally favorable for Trusted Signing / established OV | OV builds reputation slowly; EV historically stronger but costlier — **policy UNKNOWN** |
| Same gates | verify + draft release + legal identity | identical verification matrix |

Use fallback only if Trusted Signing enrollment blocked; still require HSM/cloud — **reject** “PFX in GitHub secret” as primary design.

---

## 7. Publisher / legal identity blockers

| Surface | Needs authoritative value? | Current | Blocker |
|---------|----------------------------|---------|---------|
| Authenticode signer CN / publisher | YES | N/A (unsigned) | Legal entity for cert |
| PE `CompanyName` | YES | `GitHub, Inc.` (wrong) | Must set `package.json` `author.name` (or builder publisher fields) to **real** legal name — **do not invent** |
| `copyright` | Partially set | SweetCraft / XBase | Confirm legal wording |
| NSIS display publisher | Via PE / uninstall registry | Inherited | Same identity |
| SmartScreen publisher | Cert subject | — | Same |
| UI “Maidenhead” | Product branding | Present | **Not** a substitute for legal PE/Authenticode publisher |
| `SWEETCRAFT_REQUIRE_LEGAL_IDENTITY` | Release gate | Off in CI | Must be ON for signed public builds |
| `LEGAL_IDENTITY_REQUIRED` | Docs flag | YES | Remains open until D decides |

**STOP:** no signed public release until D supplies publisher string matching certificate CN.

---

## 8. Signature verification gate (per artifact)

For each **MUST sign** artifact after signing:

1. `Get-AuthenticodeSignature` → `Status = Valid`  
2. Signer subject / publisher CN ∈ expected allowlist (from release config — not guessed)  
3. Hash algorithm SHA-256  
4. RFC3161 timestamp present and time valid  
5. Certificate chain builds to trusted root at verification time (not revoked)  
6. Packaged `LAUNCHER_BUILD_COMMIT` / `LAUNCHER_BUILD_ID` / `dirty=false` match release tag source  
7. Record **post-sign** SHA-256 in release manifest (setup EXE mandatory; main EXE optional but recommended)  
8. Inventory scan: no unexpected unsigned first-party `.exe` under install root (exclude classified third-party policy list)  
9. Fail CI if `CompanyName` still `GitHub, Inc.` on signed public build  

---

## 9. Release ordering (corrected for electron-builder)

```
1. Freeze source: annotated tag on exact commit (canonical HEAD)
2. Human/legal gate: identity + signing path approved
3. Protected workflow starts (windows-release)
4. Clean install + version:check (+ LEGAL_IDENTITY=1)
5. desktop:package:prepare (build, dirty=false)
6. electron-builder pack:
     a. write win-unpacked + asar
     b. signAndEditExecutable → main EXE (and configured signExts)
     c. build NSIS embedding signed tree
     d. sign setup (+ uninstaller per builder)
7. Verify matrix (section 8)
8. Final hashes/manifest/blockmap consistent with signed setup
9. Attach to GitHub Release as draft only
10. Explicit human publish (separate from draft create)
```

Do **not** hash-then-sign; hashes are post-sign. Do **not** publish then sign.

---

## 10. Threat model

| Threat | Mitigation |
|--------|------------|
| Stolen long-lived signing secret | Prefer OIDC + Trusted Signing; forbid PFX-in-Actions as primary; short-lived tokens |
| Malicious PR | No signing secrets on PR; no `pull_request_target`; packaging only on protected release job |
| Workflow modification | CODEOWNERS on `.github/workflows/**` + environment required reviewers; protect main |
| Untrusted fork | OIDC subject scoped to this repo + environment; no secrets to forks |
| Compromised dependency/runner | Pin action SHAs; frozen lockfile; verify artifacts; optional SLSA later |
| Artifact replacement after signing | Draft release immutable assets; checksums in release body; compare buildId |
| Wrong publisher | Legal gate + CN allowlist check in verify step |
| Expired/revoked cert | Verify chain + monitor; release fail-closed |
| Missing timestamp | Assert RFC3161 on every MUST-sign binary |
| Accidental public release | Draft-only automation; no `latest` auto; separate publish approval |

---

## 11. Human prerequisites (A/B/C/D)

### A — Repo work (implementable later in PACK-11 lots)

- Release workflow YAML (tag/dispatch, environment, OIDC permissions)  
- electron-builder signing config (azure **or** signtool) behind explicit release profile  
- `forceCodeSigning` for release profile only (keep CI main unsigned)  
- Verification script (Authenticode + publisher + timestamp + buildId)  
- Post-sign SHA-256 manifest generator  
- Wire `SWEETCRAFT_REQUIRE_LEGAL_IDENTITY=1` on release job only  
- Docs: CI.md / VERSIONING release qualification  
- CODEOWNERS / branch protection notes for workflows  

### B — GitHub configuration (human)

- Create protected environment `windows-release`  
- Environment secrets/vars as required (prefer non-secret vars for endpoint/account/profile)  
- Enforce reviewers; restrict who can approve  
- Optionally: disable Actions write on forks; pin OIDC  

### C — Microsoft / Azure / CA (human)

- Trusted Signing account + cert profile **or** OV cert in compliant HSM  
- Entra app + federated credential + role assignment  
- Confirm OIDC-only works with electron-builder 26.15.3 (lab)  
- Timestamp endpoint reachability from GitHub-hosted runners  

### D — Legal / organization (human)

- Authoritative legal publisher name (CompanyName + cert CN)  
- Copyright string finalization  
- Decision: Trusted Signing vs OV fallback  
- Policy on third-party `elevate.exe` / unsigned Electron DLLs  
- Who may publish non-draft releases  

---

## 12. Recommended PACK-11 lot sequence + STOP gates

| Lot | Scope | STOP unless |
|-----|-------|-------------|
| **11A** | This audit | — (done) |
| **11B** | Legal identity capture (docs + author field **only when D supplies value**) + PE CompanyName plan | D provides exact publisher string |
| **11C** | Lab: Trusted Signing dry-run on throwaway/internal build; decide T1 vs T2 (OIDC) | C account exists; no public release |
| **11D** | Repo: release workflow + verify gates + draft-only; still unsigned or internal-signed | B environment ready; A implemented behind flags |
| **11E** | First signed **draft** internal release from tag; full verify matrix | 11B–D PASS; CN matches |
| **11F** | Public publish playbook + SmartScreen monitoring notes | Human publish approval; no auto-latest |

### Global STOP conditions

- HEAD ≠ intended release commit  
- `dirty=true` on intended public package  
- Legal identity still invented / missing  
- Signing secrets on PR workflows  
- Force-push / unsigned “public” Release  
- Re-signing Microsoft-signed DLLs  
- Publishing before post-sign checksums  

---

## 13. Gaps marked UNKNOWN (cannot invent)

- Exact legal entity string for Authenticode / CompanyName  
- Azure subscription / Trusted Signing enrollment status  
- Whether electron-builder **26.15.3** accepts OIDC-only without client secret (needs lab)  
- EV vs OV vs Trusted Signing commercial choice  
- Policy for Electron unsigned native DLLs and `elevate.exe`  
- Future updater binary signing (no binary yet)  

Architectural path remains concrete despite UNKNOWNs: **preferred = Trusted Signing + GHA + OIDC + protected `windows-release` + draft release**; **fallback = OV/HSM + signtoolOptions**; verification and ordering are defined.

---

## Operations confirmation

- No source/config mutation beyond writing this audit under `docs/audits/**`  
- No GitHub/Azure/Microsoft changes  
- No commit / push / package / tag / release / publish / deploy  
- Local audits preserved  

## Final git status (expected)

`main...origin/main` at `aeb32b3…` with local-only `docs/audits/**` (+ possible ignored generate dirt).
