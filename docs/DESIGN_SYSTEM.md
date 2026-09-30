# Design System (0.6A)

## Direction

Premium dark immersive game launcher — XBASE violet / restrained magenta, soft glass layers, not enterprise dashboard.

## Tokens

Defined in `ui/src/styles/tokens.css`:

- `--sc-bg-*`, `--sc-surface-*`, `--sc-border-*`
- `--sc-text-*`, `--sc-accent-*`
- `--sc-success`, `--sc-warning`, `--sc-danger`
- spacing, radius, shadow, blur, z-index, motion

Components consume tokens — no scattered hex.

## Typography

Offline system stack (no Google Fonts CDN):

display / title / heading / body / caption / button / mono

French diacritics supported.

## Motion

Subtle page/CTA/modal transitions. Honor `prefers-reduced-motion: reduce`.

## Primitives

- Buttons: primary, secondary, ghost, danger, icon (+ loading)
- Badge, ProgressBar, Skeleton, Toast, Modal (focus trap / Escape / ARIA)
- Hero with overlay contrast; Account chip

## Accessibility

Semantic HTML, keyboard nav, visible `:focus-visible`, labeled title-bar controls, color not sole signal.
