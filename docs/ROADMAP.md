# Roadmap SweetCraft Launcher

## 0.6.0-beta.5 — Diagnostics fixture UI consistency

- selectedFixture single source of truth (init SUCCESS)
- Apply sends model value without requiring a dropdown change event
- Confirmation toast includes exact fixture ID
- lastAppliedFixture shown separately

## 0.6.0-beta.4 — 0.6B Final Acceptance Fix (SUCCESS fixture / Retry)

- Root cause: Account « Réessayer » called `restore()` instead of `login()` after ERROR
- After APPID/NOT_OWNED/ERROR, SUCCESS fixture + Retry now re-runs interactive fake login → JoueurDemo
- Fixture is process-only (default SUCCESS on new process); account markers still persist
- Fake never increments real browser-open count

## 0.6.0-beta.3 — 0.6B Acceptance / UX / Dev Harness Hardening

- Persistent fake-auth store (unpackaged + SWEETCRAFT_DESKTOP_AUTH_FAKE only)
- Packaged builds cannot activate FakeAuthBackend via env
- desktop:dev port 4201; fixed double `--` Angular serve args
- Home: installation UNKNOWN wording; clear sticky auth progress; toast ×
- Account: current vs saved list without brown avatar artifact
- Diagnostics: separate UI demo fixtures vs Electron fake-auth fixtures

## 0.6.0-beta.2 — Desktop Auth State / Selection / Post-Auth Hardening (0.6B)

- Explicit `authenticatedAccountId` vs `selectedAccountId`
- `select` never false-authenticates; switch A→B → SIGNED_OUT then restore
- Selection participates in auth mutex; concurrent select → BUSY
- Post-auth account-list refresh best-effort (no false auth ERROR)
- Logout other account keeps authenticated session; no auto-auth on remaining
- AppStore: no invented active account when `activeAccountId` is null

## 0.6.0-beta.1 — Microsoft Account UX / Auth Integration (0.6B)

- Desktop auth IPC + AuthDesktopService over frozen auth 0.4
- Restore (no browser) / explicit Microsoft login / logout / multi-account
- Normalized auth events; AppID / not-owned / reauth UX
- Dev fixtures; PLAY CTA presentation-only (disabled until 0.6D)
- Live OAuth still gated; AppID external blocker unchanged

## 0.6.0-alpha.3 — Final Desktop Trust Boundary Hardening (0.6A)

- Packaged app always production (`app.isPackaged` cannot be overridden to development)
- `DESKTOP_DEV_SERVER` ignored when packaged → always file renderer + production CSP
- Top-level `will-navigate` limited to exact `index.html` (+ hash/query); assets not navigable
- Dev gateway version sourced from `DESKTOP_PRODUCT_VERSION`
- Event payload validators ready for Main → renderer (0.6C progress)

## 0.6.0-alpha.2 — Desktop Trust Boundary Hardening (0.6A)

- `RendererTrustPolicy` for load / navigation / IPC sender (no arbitrary `file:`)
- Hash routing; exact configured dev origin; structured external URL rules
- IPC caller auth (main window + top frame) + `IpcResult` envelope
- Bootstrap partial hydration; readiness fallback `UNKNOWN`
- Production missing preload fail-closed; `app.isPackaged` mode; CSP from policy
- Canonical UI `AuthState`; expanded frozen error mappings

## 0.6.0-alpha.1 — Desktop Shell / UI Foundation (0.6A)

- Secure Electron shell (contextIsolation, sandbox, typed preload)
- Angular renderer + design system + French i18n
- AppStore bootstrap via LauncherDesktopGateway
- Home / Account / Settings / Diagnostics architecture
- Dev mock fixtures only — no live install/auth/play UX

## Planned (not implemented)

- **0.6C** Install / Update / Repair UX
- **0.6D** Play / Game Lifecycle UX
- **0.6E** Settings / Diagnostics / Polish
- **0.7** Packaging / Self Update / Windows Distribution

## 0.5.0-beta.4 — Cross-process GameProcessLock ownership (FROZEN 0.5B)

- PLAY exit: short InstanceLock `game-cleanup` before exact game-lock release
- Deferred cleanup if InstanceLock busy (`PLAY_CLEANUP_WARNING`)
- Multi-process tests: force-take vs late release never deletes lease B
- `runPreparedLaunch` documented legacy (no InstanceLock)

## 0.5.0-beta.3 — Post-spawn ownership + runner bind/exit race

- PROCESS_STARTED boundary: never release GameProcessLock after successful spawn
- lastUsed persistence failure is non-fatal (`PLAY_ACCOUNT_METADATA_WARNING`)
- Progress listeners cannot drop game ownership
- Runner: start() waits for onSpawned; early exit cannot swallow bind failure
- Same-process GameProcessLock file-op serialization (force-stale vs late release)

## 0.5.0-beta.2 — GameProcessLock lease + fail-closed inspect + auth abort

- Game lock schema v3 + leaseId ownership (bind/release exact)
- MALFORMED ≠ ABSENT; mutation/PLAY fail closed
- AbortSignal propagated through refresh/restore auth HTTP
- Safe public spawn/lock error messages

## 0.5.0-beta.1 — Play Orchestrator / Session Restore / Launch Readiness

- PLAY API (`startGame` / `playAndWait` / `RunningGame`)
- Readiness gates without auto install/update/repair
- Account selection + cold session restore + UUID binding
- InstanceLock → GameProcessLock handoff; mutation blocked while game runs
- CLI `launcher:play` (always waits for exit)

## 0.5.0-alpha.4 — Active transaction safety + corrupt tx fail-closed

- STATUS is read-only: lock-first; never cleans transactions
- Strict TransactionMetadata + lock.json validation (fail closed)
- Corrupt / missing metadata → RECOVERY_REQUIRED / INSTANCE_RECOVERY_REQUIRED (`CORRUPT_TRANSACTION`)
- Safe orphan cleanup only under exclusive mutating InstanceLock

## 0.5.0-alpha.3 — Recovery gate + lock ownership hardening

- Risky orphans (APPLYING/VERIFYING/COMMITTING) block all mutating ops
- No pid-only lock release fallback after lease failure
- Anti-rollback persist failure leaves COMMITTING → recovery required

## 0.5.0-alpha.2 — Orchestrator transactional hardening

- Deferred instance state commit (audit before state.json)
- Full-section InstanceLock + lease (no TOCTOU / nested lock)
- Honest transaction journal (no fake staging/); phase accuracy
- Anti-rollback only after successful state commit

## 0.5.0-alpha.1 — Application Orchestrator (Install / Update / Repair)

- STATUS / INSTALL / UPDATE / REPAIR CLI + API
- Transaction journal under `launcher/transactions/`
- Crash recovery (safe orphan cleanup + audit signal)
- Runtime prep before pack state commit
- Auth live still: `BLOCKED_EXTERNAL_APPID_APPROVAL` (does not block I/U/R)

## 0.4.0-beta.4 — Minecraft Services 403 safe diagnostics

- Classify `login_with_xbox` non-2xx without leaking bodies / remote strings
- `MINECRAFT_APP_NOT_AUTHORIZED` vs `MINECRAFT_ACCOUNT_SUSPENDED` vs `UNKNOWN`
- No blind `ensureLegacyEnabled` workaround for Invalid app registration

## 0.4.0-beta.3 — Live Xbox OAuth scope correction

- Scopes: `XboxLive.signin` + `offline_access` only (no `openid`)
- Authority: `/consumers/` for Xbox/Minecraft MSA path

## 0.4.0-beta.2 — Live authentication readiness hardening

- Windows browser via rundll32 (no cmd.exe)
- Refresh: invalid_grant → reauth; transient errors keep credential
- Secure save before memory; account metadata only after durable persist
- Safe `--diag` for first live login

## 0.4.0-beta.1 — Real Microsoft login + loopback + Windows secure storage

- Public clientId via `SWEETCRAFT_MICROSOFT_CLIENT_ID`
- Authority `/common/`
- Loopback `http://localhost:{port}/` + system browser
- `signInInteractively` / restore / logout
- Windows DPAPI refresh persistence (fail-closed elsewhere)
- Live CLI gated: `auth-login` / `auth-status` / `auth-logout`

## 0.4.0-alpha.3 — Auth exception-boundary hardening

## 0.4.0-alpha.2 — Auth secret-boundary / cancellation hardening

## 0.4.0-alpha.1 — Microsoft / Xbox / Minecraft Auth Core

## 0.3.0-beta.2 — Launch security / process lifecycle

## 0.3.0-beta.1 — Launch Engine

## 0.3.0-alpha.2 — Metadata integrity hardening

## 0.3.0-alpha.1 — Minecraft Runtime Installer

## 0.2.x / 0.1.x — Download / Instance / Core trust

## Suivant

- Auth UI / Electron packaging
- Auto-launch game after login
- Publisher verification for public distribution
- macOS/Linux keychain backends
