# 0.6F.2 V3 — ASSET MANIFEST

External reviewer generates final artworks. Do **not** reuse the hero for other slots.
Tiny placeholder WebPs currently occupy card/ambient paths for layout smoke only.

---

## A. sweetcraft-home-hero.webp

- **ID:** `HERO_HOME`
- **PATH:** `ui/src/assets/hero/sweetcraft-home-hero.webp`
- **ROLE:** Primary Home hero cinematic background
- **DIMENSIONS:** ≥ 2400×1200 (ideal 2560×1280)
- **ASPECT:** ~2:1 or 21:9 cinematic
- **TRANSPARENCY:** No (opaque)
- **SAFE ZONE:** Left ~35% softer / lower contrast for title + CTA; castle focal ~60–70% X
- **COLOR DIRECTION:** Deep purple/magenta sunset, warm campfire foreground, cool castle magic
- **LIGHTING:** Layered; avoid uniform darkness; midtones readable
- **COMPOSITION:** Castle center-right; campfire/characters lower-left foreground; sky gradient
- **OUTPUT FORMAT:** WebP (quality 80–88), optional PNG master
- **MAX TARGET SIZE:** ≤ 600 KB WebP
- **EXACT IMAGE GENERATION PROMPT:**  
  `Cinematic Minecraft-inspired fantasy landscape, wide 2:1, premium SweetCraft launcher hero. A grand illuminated castle on a hill at center-right under a violet-magenta sunset sky. Soft campfire glow in the lower-left foreground with silhouetted adventurers. Magical purple atmospheric haze, rich midtones, visible stone and foliage detail, no UI chrome, no logos, no text, no watermark. Leave left third slightly calmer for title overlay. Photoreal-stylized game concept art, immersive, high detail.`

Interim: `sweetcraft-home-hero.png` remains wired until WebP is dropped in.

---

## B. sweetcraft-server-card.webp

- **ID:** `CARD_SERVER`
- **PATH:** `ui/src/assets/cards/sweetcraft-server-card.webp`
- **ROLE:** Dedicated server identity artwork (right rail)
- **DIMENSIONS:** ≥ 640×640 (square crop friendly)
- **ASPECT:** 1:1 preferred (also works 4:5)
- **TRANSPARENCY:** Optional soft edges; opaque OK
- **SAFE ZONE:** Lower/left quieter for status text overlay if used full-bleed
- **COLOR DIRECTION:** Night portal / castle gate / server beacon — magenta accents
- **LIGHTING:** Focused glow, not washed out
- **COMPOSITION:** Vertical vignette suitable as card thumbnail (~5–6 rem square)
- **OUTPUT FORMAT:** WebP
- **MAX TARGET SIZE:** ≤ 180 KB
- **EXACT IMAGE GENERATION PROMPT:**  
  `Square premium Minecraft-inspired server emblem artwork for SweetCraft. Magical castle gate or end-portal style beacon at night with violet-magenta light rays, subtle particle sparkles, dark elegant background, no text, no logos, no UI, no player count, cropped for a launcher card thumbnail.`

---

## C. sweetcraft-community-card.webp

- **ID:** `CARD_COMMUNITY`
- **PATH:** `ui/src/assets/cards/sweetcraft-community-card.webp`
- **ROLE:** Community panel left visual
- **DIMENSIONS:** ≥ 960×640
- **ASPECT:** ~3:2
- **TRANSPARENCY:** No
- **SAFE ZONE:** Soft edges; can be full-bleed in rounded panel
- **COLOR DIRECTION:** Warm village dusk + purple sky, welcoming social vibe
- **LIGHTING:** Golden lanterns + magenta sky
- **COMPOSITION:** Village plaza / gathering, people as silhouettes OK
- **OUTPUT FORMAT:** WebP
- **MAX TARGET SIZE:** ≤ 250 KB
- **EXACT IMAGE GENERATION PROMPT:**  
  `Warm Minecraft-inspired community village at dusk for SweetCraft launcher community card. Lantern-lit plaza, friendly gathering silhouettes, purple-magenta sky, cozy and premium, no text, no Discord logo, no watermark, cinematic crop 3:2.`

---

## D. sweetcraft-pack-art.webp

- **ID:** `CARD_PACK`
- **PATH:** `ui/src/assets/cards/sweetcraft-pack-art.webp`
- **ROLE:** Modpack / package artifact art for Pack card
- **DIMENSIONS:** ≥ 512×512
- **ASPECT:** 1:1
- **TRANSPARENCY:** Preferred (soft alpha) or dark opaque plate
- **SAFE ZONE:** Center subject; margins for circular/rounded crop
- **COLOR DIRECTION:** Enchanted crate / sweet-themed modpack chest
- **LIGHTING:** Magenta rim light
- **COMPOSITION:** Single iconic pack object, not landscape
- **OUTPUT FORMAT:** WebP
- **MAX TARGET SIZE:** ≤ 120 KB
- **EXACT IMAGE GENERATION PROMPT:**  
  `Iconic SweetCraft modpack artifact, square, enchanted wooden crate wrapped with violet ribbon and glowing magenta runes, premium game item render, dark background, soft rim light, no text, no logos, not a landscape, not a hero crop.`

---

## E. sweetcraft-install-art.webp

- **ID:** `CARD_INSTALL`
- **PATH:** `ui/src/assets/cards/sweetcraft-install-art.webp`
- **ROLE:** Installation / readiness motif for Install card
- **DIMENSIONS:** ≥ 512×512
- **ASPECT:** 1:1
- **TRANSPARENCY:** Preferred
- **SAFE ZONE:** Center subject
- **COLOR DIRECTION:** Crystal / enchanted block / download chest — distinct from pack crate
- **LIGHTING:** Cool violet with green readiness accents optional
- **COMPOSITION:** Single object communicating “ready / install”
- **OUTPUT FORMAT:** WebP
- **MAX TARGET SIZE:** ≤ 120 KB
- **EXACT IMAGE GENERATION PROMPT:**  
  `Premium stylized Minecraft installation motif, square, glowing amethyst crystal block merging with a subtle download-chevron energy, violet-magenta lighting, dark elegant background, distinct from a wooden crate, no text, no logos, launcher card icon.`

---

## F. sweetcraft-home-ambient-right.webp

- **ID:** `AMBIENT_RIGHT`
- **PATH:** `ui/src/assets/ambient/sweetcraft-home-ambient-right.webp`
- **ROLE:** Decorative bottom-right atmospheric dissolve behind rail
- **DIMENSIONS:** ≥ 1200×1400
- **ASPECT:** Portrait-leaning ~5:6
- **TRANSPARENCY:** Soft alpha preferred OR opaque with dark edges for CSS mask fade
- **SAFE ZONE:** Subject on right; left and top must fade to empty/dark for dissolve
- **COLOR DIRECTION:** Soft castle silhouette / purple mist, low contrast
- **LIGHTING:** Subtle, never compete with cards
- **COMPOSITION:** Environmental only; designed to mask-fade into `#07070d`
- **OUTPUT FORMAT:** WebP
- **MAX TARGET SIZE:** ≤ 280 KB
- **EXACT IMAGE GENERATION PROMPT:**  
  `Soft atmospheric Minecraft fantasy mist for launcher ambient background, portrait orientation, castle silhouette fading on the right, violet haze dissolving to pure black on the left and top, very low contrast, decorative only, no text, no UI, no bright focal subject in the center.`

---

## G. xnosweet-mark.svg

- **ID:** `BRAND_XNOSWEET`
- **PATH:** `ui/src/assets/branding/xnosweet-mark.svg`
- **ROLE:** Official XNOSWEET creator/community mark (sidebar footer)
- **STATUS:** **PROVIDED-BRAND-ASSET REQUIRED** — do not AI-invent a final logo
- **DIMENSIONS:** SVG, visual height ~18–28 px at 120–160 px wide
- **ASPECT:** Wide wordmark or compact mark+word
- **TRANSPARENCY:** Yes
- **COLOR DIRECTION:** Works on near-black; lavender `#c4b5fd` / magenta accents OK
- **OUTPUT FORMAT:** SVG (optimized)
- **MAX TARGET SIZE:** ≤ 40 KB
- **NOTE:** Current file is a temporary text-only fallback wordmark. Replace with official brand asset.

---

## FONT ASSET REQUIREMENT

- **ID:** `FONT_DISPLAY_SCRIPT`
- **PATH:** `ui/src/assets/fonts/sweetcraft-script.woff2`
- **CSS:** `--sc-font-display-script` / `@font-face 'SweetCraft Script'`
- **STYLE:** Premium handwritten / editorial script
- **MUST:** French accents (é, è, à, …), readable at 14–22 px, not childish, not graffiti, not wedding-calligraphy overload
- **LICENSE:** Commercially usable / open (SIL OFL or paid desktop license covering Electron redistribution)
- **USAGE:** Top slogan + hero tagline only

---

## SweetCraft mark note

Existing `logo.svg` is a placeholder “M” gradient mark — acceptable interim, but **final SweetCraft brand mark should be provided externally** if higher fidelity is required. Do not replace with unrelated generic gaming icons.
