# PACK-PAX-07.1 — Finitions visuelles et captures isolées

**Statut :** TERMINÉ
**Date :** 2026-10-01
**HEAD :** `33499137b02a3057f3891b978a8b484f06d44c57` — **aucun commit**
**WIP :** 03→07.1 préservé.

## Corrections

| Point | Correction |
| --- | --- |
| CTA primary or | Texte/icône `var(--sc-bg-app)` (#10171f) ; hover/focus/disabled cohérents |
| Communauté | Bouton « Gérer mon compte » retiré ; action uniquement dans la carte compte |
| Serveur | Affichage « non configuré » (i18n) — DTO `not-configured` inchangé |
| Footer | Slogan droit retiré ; centre = `name vX · PaxCraft / Pax Horizon` |
| Modale | Fonds/bordures/icônes violets → tokens Pax ; danger rouge conservé |
| Titlebar ≤1100px | Grille **3 colonnes** conservée (bug : `1fr auto` déplaçait le × vers la sidebar) |

## Contamination des scènes (cause)

**Cause :** harness 07 réutilisait la même session Angular/Dev gateway.
La scène `NETWORK_ERROR` + install laissait `operationError` / toasts ; READY et modale héritaient l’alerte.

**Correctif harness :** rechargement SPA `?capture=<nonce>#/…` avant chaque scène + clear `statusError` / `operationError` après fixtures.
Aucun masquage d’erreur dans les templates.

Scène erreur 06 : capture d’un état d’erreur cohérent (fixture + mutation) — **attendu**.

## Viewport réduit (1100×700)

| Observation | Diagnostic |
| --- | --- |
| × près de la sidebar (07) | **Layout** titlebar : `@media` passait à 2 colonnes pour 3 enfants → contrôles mal placés |
| Cartes bas coupées | **Capture / hauteur** : zone `.content` scrollable — actions accessibles au scroll, pas un défaut d’accessibilité |
| Controles après fix | Close/minimize restent à droite ; drag region préservée |

## Validation

| Check | Résultat |
| --- | --- |
| Tests UI | **237 PASS** |
| `ng build` development | **PASS** |
| Captures | **12/12** → `docs/pax-baseline/visual-after/PACK-PAX-07.1/` |
| PACK-PAX-07 | **Préservé** |
| Electron / réseau produit | Non lancés |

Inspecté : READY (sans erreur parasite), BUSY, erreur, modale, 1100×700.

## Fichiers touchés

- `ui/src/app/shared/components/button/button.component.ts`
- `ui/src/app/shared/components/cta/cta.component.ts`
- `ui/src/app/shared/components/modal/modal.component.ts`
- `ui/src/app/shared/components/toast/toast.component.ts`
- `ui/src/app/features/home/home.page.ts`
- `ui/src/app/layout/title-bar/title-bar.component.ts`
- `ui/src/app/layout/status-bar/status-bar.component.ts`
- `ui/src/assets/i18n/fr.json` (`home.server.unconfigured`)
- `scripts/pax-visual-capture/capture-cdp.mjs` (OUT 07.1 + isolation)
- `docs/pax-baseline/visual-after/PACK-PAX-07.1/**`
- `docs/pax-baseline/PACK-PAX-07.1.md`, `CURRENT_STATE.md`

## Limites

- Badge sémantique « OPÉRATION EN COURS » reste variante `info` (bleu) — distinct du CTA or.
- Compte/paramètres : hors périmètre.
- Captures = renderer navigateur hermétique.
