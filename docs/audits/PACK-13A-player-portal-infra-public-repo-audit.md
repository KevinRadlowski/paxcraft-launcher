# PACK-13A — PLAYER PORTAL / INFRA / PUBLIC REPO AUDIT

**STATUS:** `AUDIT_COMPLETE` (read-only) — décisions VPS live **BLOCKED/UNKNOWN** sans accès SSH/prod.

**Date:** 2026-09-22  
**Invariant:** NO COMMIT / PUSH / TAG / RELEASE EDIT / PUBLIC VISIBILITY CHANGE / DNS CHANGE / DEPLOY.

---

## STARTING_HEAD / origin / worktree

| Champ | Valeur |
|-------|--------|
| Repo (cwd audit) | `SweetCraft-Launcher` |
| `HEAD` | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| Branche | `main` (suit `origin/main`) |
| `origin` | `https://github.com/KevinRadlowski/SweetCraft-Launcher.git` |
| Worktree | Dirty **untracked** uniquement (`docs/audits/**` WIP + aucun tracked modifié au moment du snapshot final) |
| Tag canonique RC | `v0.6.0-rc.18` @ `c203dc0` |
| buildId | `0.6.0-rc.18@c203dc0f0772` |
| Setup SHA-256 | `080047ecdeb80a9c0a83b768e9c8f1a44f38696929f4ecf9b6717d0bd155524d` |

Aucune mutation git / DNS / Nginx / GitHub visibility pendant cet audit.

---

## A — Dépôts / espaces accessibles

| Artefact | Chemin / remote | Visibilité | Preuve |
|----------|-----------------|------------|--------|
| SweetCraft Launcher | `LAUNCHER/SweetCraft-Launcher` → `KevinRadlowski/SweetCraft-Launcher` | **PRIVATE** | `gh repo view` |
| Site XNOSWEET | `SITE WEB` → `KevinRadlowski/xnosweet` | **PRIVATE** | `gh repo view` ; HEAD local `61a9ede50b25aedd908b40c2dc874fddb4330b45` (`main`, ahead 5 vs origin — WIP local site) |
| Pack Manager | `LAUNCHER/SweetCraft-PackManager-v0.4` → `KevinRadlowski/sweetcraft-pack-manager` | **PRIVATE** | Hors périmètre portail joueur ; producteur |
| Infra dédiée | **Absente** comme dépôt séparé | — | Templates seulement : `SITE WEB/infrastructure/{nginx,systemd,DEPLOY.md}` |

**Manquant (non inventé) :** configs Nginx **live** VPS, accès SSH, panneau DNS IONOS authentifié, Certbot live listing, firewall UFW/iptables, inventaire complet des vhosts 80/443.

---

## B — Page SweetCraft existante (`/sweetcraft`)

### Structure (code + live)

- SPA Angular **22.x** (`xnosweet-web` 0.1.0), `base href="/"` (`frontend/src/index.html`).
- Route lazy : `path: 'sweetcraft'` → composant `features/sweetcraft/*` (`app.routes.ts`).
- Contenu **CMS-first** via `GET /api/public/config` → bloc `sweetcraft` (+ status `GET /api/public/sweetcraft/status`).
- Live `https://xnosweet.fr/sweetcraft` : **HTTP 200**, `Server: nginx/1.24.0 (Ubuntu)`, HSTS, CSP Report-Only.
- Backend : Spring Boot **4.1.1** / Java 21 ; API proxifiée `/api/` → `127.0.0.1:11000` (template + health live OK).

### Section Launcher (déjà dans la page)

- `launcherEnabled: true` ; CTA externe si `launcherUrl` défini.
- Live CMS : **pas de champ `launcherUrl`** dans la réponse publique → UI **« Bientôt disponible »** (confirmé).
- Pas d’affichage version / taille / SHA aujourd’hui (URL seule).

### DA / assets

- Identité visuelle site XNOSWEET + médias SweetCraft (`/media/...`, fallbacks statiques).
- Assets **root-relative** (`/media/...`, `/xbase`, `/planning`) — OK sous apex ; sous sous-domaine **même origin document root** ils restent cohérents si la SPA est la même.
- Liens internes `routerLink` absolus type `/xbase` : restent sur le **host courant** → sur `sweetcraft.xnosweet.fr` un clic « XBASE » irait vers `sweetcraft.xnosweet.fr/xbase` (page site complète) sauf garde host / liens apex forcés.

### Peut-elle être la racine `/` du sous-domaine ?

| Option | Faisable sans 2e site ? | Notes |
|--------|-------------------------|--------|
| **R1** Redirect `sweetcraft.xnosweet.fr` → `https://xnosweet.fr/sweetcraft` | Oui (Nginx seul) | Pas une vraie racine portail ; canonical reste apex |
| **R2** Même SPA + route host-aware : Host `sweetcraft.*` → composant Sweetcraft sur `''` | Oui (front + Nginx) | **Recommandé** pour `/` dédié sans dupliquer DA |
| **R3** Rewrite Nginx `/` → `/sweetcraft` + même root | Partiel | Fragile (deeplinks, SEO, `routerLink`) |
| Nouveau mini-site Launcher | Non requis | Contredit « no second independent site » |

**Verdict B :** réutiliser `features/sweetcraft` + CMS ; **ne pas** cloner. Rendre `/` sur le sous-domaine = **PACK-13B** (routing/SEO), pas un nouveau repo.

### SEO / conflits

- Meta `PAGE_META.sweetcraft.path = '/sweetcraft'` + canonical via `SITE.url` (apex) — **à étendre** pour le host sous-domaine (sinon og:url/canonical faux).
- Twitch `parentHosts.production` = `xnosweet.fr`, `www.xnosweet.fr` **seulement** — embeds Twitch sur le sous-domaine cassés tant que non ajouté (si un embed est servi depuis ce host).
- Conflit principal : navigation shell XNOSWEET complète sur le sous-domaine (header/footer multi-pages) — acceptable V1 si assumé ; sinon shell réduit host-aware (hors minimum strict).

---

## C — VPS / DNS / HTTPS (preuves vs UNKNOWN)

| Sujet | Preuve | Statut |
|-------|--------|--------|
| IP apex | `xnosweet.fr` A → `87.106.2.194` | Confirmé (résolution locale) |
| Ingress | HTTPS apex + `/sweetcraft` 200 ; API health UP | Confirmé |
| Nginx | Version live `1.24.0 (Ubuntu)` ; template doc `/var/www/xnosweet`, proxy API `:11000` | Template ≠ live certifié |
| TLS | HTTPS fonctionne + HSTS ; doc Certbot | Renouvellement live **NON DÉTERMINABLE** sans SSH |
| DNS provider | NS `*.ui-dns.*` / SOA `hostmaster.1und1.com` → **IONOS/1&1** | Confirmé (NS) |
| `sweetcraft.xnosweet.fr` | **NXDOMAIN** | Confirmé — **aucun** enregistrement |
| Ports 80/443 | Partagés apex (SPA + `/api` + `/media`) | Confirmé par template + live headers |
| Firewall / autres vhosts | — | **UNKNOWN** |

### Mapping minimal proposé (aucune mutation)

1. Kevin (DNS IONOS) : `A` (et `AAAA` si IPv6) `sweetcraft.xnosweet.fr` → **même IP** que `xnosweet.fr` (sauf preuve contraire).
2. VPS (approuvé) : vhost Nginx `server_name sweetcraft.xnosweet.fr` ; **même** `root /var/www/xnosweet` ; `try_files` SPA ; `/api/` et `/media/` **mêmes** proxies localhost.
3. Certbot : certificat (ou SAN) pour `sweetcraft.xnosweet.fr` ; HTTP→HTTPS.
4. Conserver apex `/sweetcraft` (compat + SEO) ; choisir canonical (recommandation : basculer canonical vers sous-domaine **après** cutover stable).

---

## D — GitHub public-readiness (SECURITY GATE)

### Périmètre inspecté

- HEAD tracked files ; `git rev-list --all` = **32** commits ; branches : `main`, `origin/legacy-public-readme` (historique **orphan**, no merge-base avec `main`) ; tag `v0.6.0-rc.18`.
- Patterns history (`git grep` all commits) : `BEGIN *PRIVATE KEY`, `ghp_`, `github_pat_`, `AKIA`, `CURSEFORGE_API_KEY=`, `CF_API_KEY=` → **0 hit** sur Launcher.
- Pack Manager (adjacent, 4 commits) : hits « PRIVATE KEY » = **faux positifs** (redacteur de logs, fixtures PUBLIC, garde-fous scripts) — **pas** d’exposition de clé privée confirmée dans ce scan.
- Fichiers sensibles tracked HEAD : **aucun** `.env` / credentials / `.pem` privés ; `config/trusted-keys.json` = **clés publiques** uniquement (commentaire explicite).
- `.gitignore` : `.env*`, `*.pem`, `*.key` (exception trusted-keys public).
- Actions : `ci-main` / `ci-pr` `permissions: contents: read` ; `player-release` job `contents: write` + `environment: player-release` ; **`gh secret list` vide** (pas de secrets Actions nommés visibles).
- README HEAD : périmé (`0.4.0-alpha.1`) — scrub avant public.
- **LICENSE : absente.**

### CurseForge (historique compromis)

- Références « curseforge » dans l’historique Launcher = docs / types provider (`provider.url` trusted), **pas** d’assignation de clé.
- Usage clé CurseForge observé historiquement côté **Pack Manager** via variable d’environnement (hors git) — **pas** de `CURSEFORGE_API_KEY=` dans l’historique git inspecté PM/Launcher.
- **Verdict :** aucune **exposition confirmée dans l’historique git reachable** inspecté. Une fuite **hors git** (chat, machine locale, ancien outil) reste **NON DÉTERMINABLE** ici → rotation/révocation CurseForge = **action humaine** si la clé a jamais été partagée ; **ne pas** réécrire l’historique git.

### Verdict sécurité public-repo

| Classe | Résultat |
|--------|----------|
| Pas de finding (scope inspecté) | Pas de secret pattern confirmé dans history Launcher ; pas de secret Actions listé |
| Exposition confirmée | **Aucune** dans le scope git inspecté |
| Incomplet / non inspectable | Contenu binaire massif non text-grep ; secrets **jamais** commités ; panneau GitHub org/Environments protections ; contenu exact branche orphan `legacy-public-readme` non audité ligne à ligne |

**VERDICT :** `CONDITIONAL_GO` — ouverture publique **acceptable côté secrets git inspectés**, **bloquée opérationnellement** tant que : LICENSE + README public-facing + revue branche orphan + confirmation humaine rotation CurseForge (si applicable) + acceptation que le code source + historique 32 commits deviennent lisibles.

**Ne pas** force-push / filter-repo sans pack remediation séparé approuvé (non requis sur findings actuels).

---

## E — Distribution publique des releases

| Check | Résultat |
|-------|----------|
| Release `v0.6.0-rc.18` | Publiée, **prerelease**, non-draft |
| Assets | `SweetCraft.Launcher-0.6.0-rc.18-win-x64-setup.exe` (~85.8 Mo) + `player-release-manifest-win-x64.json` |
| Digest asset setup | `sha256:080047ec…524d` (aligné manifeste) |
| Download **non authentifié** | **HTTP 404** (repo PRIVATE) — confirmé `curl -sI` sur URL browser |
| Download **authentifié** (`gh`) | OK (manifeste récupérable) |

### Conséquence visibilité

- Passer le repo en **public** ⇒ les assets de Release GitHub existants deviennent téléchargeables **sans auth** (modèle GitHub standard). **C’est le chemin V1 minimal** pour les joueurs.
- Garder le repo **privé** ⇒ il faut un stockage binaire **public séparé** (object storage / release mirror). Proxy binaire via VPS : **non justifié** (bande passante, cache, responsabilité).

### Contrat de téléchargement stable (sans hardcoder partout)

1. Source de vérité artefact : GitHub Release tag (RC aujourd’hui).
2. Site : champ CMS `launcherUrl` = URL browser GitHub **ou** (mieux) URL stable same-origin `https://sweetcraft.xnosweet.fr/download/launcher` → **302** vers l’asset GitHub (redirect léger, pas proxy body).
3. Affichage version / taille / SHA : consommer `player-release-manifest-win-x64.json` (publié à côté de l’exe) — ne pas dupliquer les chiffres en dur dans Angular.
4. UI : badge **RC / préversion** + guidance SmartScreen (binaire **unsigned**).
5. Stable ultérieur : même contrat, canal `stable` quand un tag non-rc existera.

---

## F — Architecture minimale recommandée

```
[DNS IONOS] sweetcraft.xnosweet.fr → VPS 87.106.2.194
        ↓
[Nginx vhost + Let’s Encrypt]  root = /var/www/xnosweet (même SPA)
        ↓
[Angular host-aware]  Host sweetcraft → page Sweetcraft sur /
        + apex /sweetcraft conservé
        ↓
[CMS launcherUrl / redirect /download] → GitHub Release asset (public)
        ↓
[Joueur] setup.exe unsigned + manifeste SHA-256
```

**Ownership**

| Concern | Repo |
|---------|------|
| Page portail + CMS + Nginx templates | `xnosweet` (SITE WEB) |
| Binaires + manifeste + CI release | `SweetCraft-Launcher` |
| Pack / signatures distribution jeu | Pack Manager (reste privé) |

**Éviter V1 :** nouvelle API, DB, auth joueur, admin download, proxy exe VPS.

---

## Plan PACK-13B / C / D / E (minimal)

| Pack | Contenu | Gate |
|------|---------|------|
| **13B** | Routing host-aware + SEO/canonical sous-domaine + liens apex pour nav hors-SweetCraft + Twitch parents si besoin | Code SITE WEB ; tests unitaires routes/SEO |
| **13C** | LICENSE + README public + revue/suppression branche orphan + checklist secrets humaine + **Kevin** bascule visibilité repo Launcher | Security gate ; pas de rewrite history |
| **13D** | Brancher CTA : CMS `launcherUrl` (+ option redirect `/download`) ; afficher semver/size/SHA depuis manifeste ; copy SmartScreen / unsigned RC | Après 13C public **ou** stockage public alternatif |
| **13E** | DNS A + Nginx vhost + Certbot + reload ; smoke HTTPS ; rollback = retirer vhost / DNS | **Approbation Kevin** ; runbook depuis `infrastructure/` |

Critères d’acceptation (synthèse) :

- `https://sweetcraft.xnosweet.fr/` sert le contenu SweetCraft (ou redirect documenté).
- Apex `/sweetcraft` non cassé.
- Download joueur sans compte GitHub.
- SHA-256 affiché = manifeste / asset.
- Aucun secret dans le repo public (re-check HEAD + history patterns).

---

## Next actions (séparées)

### Cursor (implémentation code — packs suivants, pas ce lot)

- SITE WEB : host-aware Sweetcraft root ; SEO ; optionnel route `/download` → redirect.
- Launcher : LICENSE + README public-facing ; doc SmartScreen joueur ; (optionnel) endpoint/doc contrat manifeste.
- Écrire tests ; **pas** de deploy.

### Kevin (manuel)

- Confirmer / rotator clé CurseForge si elle a jamais fuité hors git.
- IONOS : créer DNS `sweetcraft.xnosweet.fr`.
- GitHub : après 13C, passer `SweetCraft-Launcher` en **public** (et décider du sort de `legacy-public-readme`).
- CMS admin : renseigner `launcherUrl` (+ textes launcher) quand l’URL publique est stable.
- Approuver fenêtre 13E VPS.

### VPS (déploiement — approbation requise)

- Ajouter vhost Nginx (template étendu).
- `certbot` pour le sous-domaine.
- `nginx -t && reload` ; smoke tests ; plan rollback.

---

## Explicit non-actions (ce pack)

NO COMMIT / PUSH / TAG / RELEASE EDIT / PUBLIC VISIBILITY CHANGE / DNS CHANGE / DEPLOY.
