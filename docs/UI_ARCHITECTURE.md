# UI Architecture (0.6A)

## Stack

Angular 19 standalone + signals + `inject()` + OnPush components.

No NgRx. No React. No Next.js.

## Layers

```
features/   home, account, settings, diagnostics
layout/     shell, title-bar, sidebar, status-bar
shared/     button, badge, hero, cta, modal, toast, progress, skeleton
core/       gateway, store, bootstrap, i18n, errors
```

## Gateway

`LauncherDesktopGateway` abstraction:

- `ElectronLauncherDesktopGateway` → `window.sweetcraft`
- `DevLauncherDesktopGateway` → in-memory fixtures (dev only)

Components never call IPC channels directly.

## AppStore (signals)

Hydrates from bootstrap:

`getInfo` → `getStatus` → `accounts.list` → `settings.get`

Models explicit enums: readiness, auth, game, operation — not boolean soup.

**Never stores tokens.**

## Routes

| Path | Screen |
|------|--------|
| `/home` | Hero + CTA + server + account |
| `/account` | Account summary states |
| `/settings` | Sections; unwired controls marked |
| `/diagnostics` | Safe versions + demo fixtures (dev) |

## CTA mapping

Pure function `mapPrimaryAction(readiness, auth)` → presentation only.

## i18n

French-first catalog: `ui/src/assets/i18n/fr.json` + message keys.

## Branding slots

```
ui/src/assets/branding/logo.svg
ui/src/assets/branding/wordmark.svg
ui/src/assets/hero/   (local artwork only — no hotlink)
```

## Future lots

- 0.6B Microsoft account UX
- 0.6C Install/Update/Repair UX
- 0.6D Play lifecycle UX
- 0.6E Settings/Diagnostics polish
