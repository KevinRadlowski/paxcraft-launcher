# PACK-13E-AUDIT — SWEETCRAFT SUBDOMAIN DEPLOYMENT PRE-FLIGHT

**STATUS:** `PLAN_READY` / **DEPLOY BLOCKED** until Kevin approves source scope + DNS/VPS actions  
**Date:** 2026-09-23  
**Invariant:** NO COMMIT / PUSH / DNS / NGINX / CERTBOT / VPS / DEPLOY / CANONICAL CUTOVER

SSH live VPS: **non disponible** (pas de `~/.ssh/config` ; aucune inspection live Nginx/Certbot).  
Findings live limités aux sondes HTTPS/DNS publiques.

---

## STARTING_HEAD / ENDING_HEAD

| Champ | Valeur |
|-------|--------|
| HEAD | `fe79001c1bc7c4f3edba9d5631b5248d3b8a2eff` |
| ENDING_HEAD | **identique** (aucune mutation) |
| Branche | `main` |
| origin | `https://github.com/KevinRadlowski/xnosweet.git` |
| ahead / behind | **8 / 0** vs `origin/main` (`e456f6704d2253bdc3fef035e99ca4b412ab179d`) |
| Worktree | Dirty : ~77 entrées porcelain ; WIP 13B/13D **non commités** + artefacts générés |

---

## 1 — Git / périmètre de déploiement

### Commits locaux ahead (8) — **tous Creator Studio admin**

| Commit | Résumé |
|--------|--------|
| `fe79001` | feat(admin): Reseaux editor CS V2 |
| `034aabb` | feat(admin): Live editor CS V2 |
| `58fed5c` | feat(admin): XNOSWEET editor CS V2 |
| `61a9ede` | feat(admin): Planning editor CS V2 |
| `295560b` | feat(admin): media library/picker |
| `124dddd` | feat(admin): Homepage editor CS V2 |
| `7aa11f2` | feat(admin): platforms centralization |
| `f9bcdf1` | feat(admin): Creator Studio V2 shell |

**Aucun** de ces commits n’est PACK-13B/13D.  
**Ne pas** assumer qu’un push blanket de `main` déploie le portail SweetCraft.

### WIP PACK-13B (host-aware) — tracked modified + untracked

| Path | Rôle |
|------|------|
| `frontend/src/app/core/config/site-host.ts` (+ spec) | Hostname portal / nav apex / canonical policy |
| `frontend/src/app/app.routes.ts` (+ spec) | `buildAppRoutes` apex vs portal |
| `frontend/src/app/layout/header/*` | Nav host-aware |
| `frontend/src/app/layout/footer/*` | Nav host-aware |
| `frontend/src/app/core/seo/*` | Canonical / OG |
| `frontend/src/app/core/config/site.config.ts` (+ spec) | Twitch parents + `sweetcraft.xnosweet.fr` |
| `frontend/src/environments/environment*.ts` | `sweetcraftPortalOrigin`, **`sweetcraftPortalCanonicalCutover: false`** |
| `infrastructure/PACK-13B-sweetcraft-portal-routing.md` | Doc |
| `infrastructure/DEPLOY.md` | Note portail |

### WIP PACK-13D / FIX (download)

| Path | Rôle |
|------|------|
| `frontend/src/app/core/config/sweetcraft-launcher-release.ts` (+ spec) | RC vérifiée ; CTA **sans** override CMS |
| `frontend/src/app/features/sweetcraft/sweetcraft.{ts,html,scss,spec.ts}` | Section `#sc-launcher` |

### Unrelated / generated (exclure du commit portail)

- `.tmp-deploy/`, `.tmp-playwright/`, `_release/`
- Nombreux `CREATOR-STUDIO-*.md`, scripts CMS/QA, `readiness_body.txt`, proxies gate
- `frontend/package-lock.json` modifié — **à examiner** avant tout commit (peut être collatéral)

### Stratégie source non destructive (proposée)

**Décision Kevin requise :** le déploiement portail doit-il aussi livrer les **8 commits admin CS V2** ?

| Option | Description |
|--------|-------------|
| **A — Portail only** | Depuis `origin/main`, branche `pack-13e-portal` ; commit **uniquement** fichiers 13B+13D listés ; push branche ; build/deploy depuis cette ref. Les 8 commits admin restent locaux non poussés. |
| **B — Portail + CS V2** | Commit 13B+13D sur `main` local actuel ; push `main` (8 admin + portail) ; deploy tip. |
| **C — Deux déploiements** | D’abord A (prod portail), CS V2 plus tard après revue séparée. |

**Recommandation audit :** **A** ou **C** — évite de coupler portail joueur et refonte admin non revue pour la prod.

État déployable portail = **après commit dédié 13B+13D** (aujourd’hui WIP seulement).

---

## 2 — Infrastructure (repo vs live)

### Repo (vérifié)

- Déploiement **manuel** (`infrastructure/DEPLOY.md`) — pas Docker/Compose dans le dépôt.
- Nginx : **template documentaire** `infrastructure/nginx/README.md` — `server_name xnosweet.fr www` ; root `/var/www/xnosweet` ; `try_files` SPA ; `/api/` + `/media/` → `127.0.0.1:11000`.
- systemd : template `xnosweet-api` bind `127.0.0.1:11000`.
- Aucun secret versionné (contrat doc).

### Live (sondes publiques seulement)

| Observation | Preuve |
|-------------|--------|
| Apex `/sweetcraft` | HTTPS **200**, `nginx/1.24.0 (Ubuntu)`, HSTS, CSP Report-Only |
| API health | `GET /api/health` → `{"status":"UP","service":"xnosweet-api"}` |
| API config publique | `GET /api/public/config` → **200** JSON |
| SPA Last-Modified | `Fri, 18 Sep 2026` (front live **plus ancien** que WIP local) |
| Vhosts / Certbot / ports / autres services | **UNKNOWN** (pas de SSH) |

### Commandes Kevin (SSH, plus tard — ne pas exécuter ici)

```bash
# Inventaire (lecture seule)
sudo nginx -T | less
ls -la /etc/nginx/sites-enabled/
sudo certbot certificates
ss -tlnp | grep -E ':80|:443|:11000'
systemctl status nginx xnosweet-api --no-pager
ls -la /var/www/xnosweet | head
```

---

## 3 — DNS (lecture seule publique)

| Nom | Observation |
|-----|-------------|
| `xnosweet.fr` A | **87.106.2.194** |
| `www.xnosweet.fr` A | **87.106.2.194** |
| AAAA apex | **non observé** (vide / NON DÉTERMINABLE IPv6) |
| `sweetcraft.xnosweet.fr` | **NXDOMAIN** — aucun enregistrement |
| NS | IONOS/`ui-dns` (`ns1048.ui-dns.de`, etc.) |

Zone IONOS exacte (TTL, enregistrements privés) : **UNKNOWN** hors résolution publique.  
IP VPS pour le plan : utiliser **87.106.2.194** (observée aujourd’hui) — re-vérifier juste avant création DNS.

---

## 4 — Routage sous-domaine (code WIP)

Comportement attendu (`site-host` + `buildAppRoutes`) :

| Host | `/` | `/sweetcraft` | Autre |
|------|-----|---------------|-------|
| Apex | Home | SweetCraft + CTA download | Site complet |
| `sweetcraft.xnosweet.fr` | **Même** feature SweetCraft | redirect → `/` | 404 |

- Nav portail → apex pour hors-SweetCraft ; CTA download = URL GitHub vérifiée (13D-FIX).
- `sweetcraftPortalCanonicalCutover: **false**` — canonical portail reste `{apex}/sweetcraft` jusqu’à cutover volontaire.
- Twitch parents WIP incluent `sweetcraft.xnosweet.fr` (utile si embed sur ce host).
- API/media : chemins root-relatifs `/api`, `/media` — OK si **même** `root` Nginx + mêmes `location` sur le vhost sous-domaine.
- Cookies admin : même apex policy ; portail public ne nécessite pas d’auth joueur.

---

## 5 — Architecture proposée

```
[IONOS DNS] sweetcraft.xnosweet.fr  A → 87.106.2.194
        ↓
[Nginx] server_name sweetcraft.xnosweet.fr
        root /var/www/xnosweet   # MÊME SPA que apex
        try_files SPA ; /api/ /media/ → 127.0.0.1:11000
        TLS Certbot (cert dédié ou SAN)
        ↓
[Angular] Host sweetcraft → Sweetcraft @ /
        cutover flag false jusqu’à smoke OK
```

Pas de 2ᵉ backend / DB / proxy EXE.

### Template Nginx documentaire (proposition — non appliqué)

```nginx
# /etc/nginx/sites-available/sweetcraft.xnosweet.fr
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sweetcraft.xnosweet.fr;

    # ssl_certificate     /etc/letsencrypt/live/sweetcraft.xnosweet.fr/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/sweetcraft.xnosweet.fr/privkey.pem;

    # Reprendre les mêmes add_header / try_files /api /media que xnosweet.fr
    root /var/www/xnosweet;
    # ... (copier bloc apex, adapter server_name uniquement)
}

server {
    listen 80;
    listen [::]:80;
    server_name sweetcraft.xnosweet.fr;
    return 301 https://$host$request_uri;
}
```

---

## 6 — Plan ordonné + rollback

| Étape | Action | Qui | Précondition |
|-------|--------|-----|----------------|
| **A** | Choisir option A/B/C ; commit **seulement** fichiers 13B+13D (exclure `.tmp*`, audits CS, etc.) ; push ref choisie | Kevin + agent sur ordre | Revue diff |
| **B** | `npm ci && npm run build` ; déployer `dist/xnosweet-web/browser/` → `/var/www/xnosweet` (backup dossier précédent) | Kevin VPS | Ref A poussée |
| **C** | IONOS : `A sweetcraft` → `87.106.2.194` (re-check IP) | Kevin IONOS | — |
| **D** | Ajouter vhost Nginx (même root/API/media) ; `nginx -t` ; reload | Kevin VPS | DNS propage ou hosts test |
| **E** | `certbot --nginx -d sweetcraft.xnosweet.fr` (ou équivalent) | Kevin VPS | 80 ouvert, DNS pointe |
| **F** | Smoke : `https://sweetcraft.xnosweet.fr/` SweetCraft ; `/sweetcraft`→`/` ; nav apex ; `/api/health` ; CTA download ; apex `/sweetcraft` non régressé | Kevin | TLS OK |
| **G** | Canonical cutover (`sweetcraftPortalCanonicalCutover: true`) **uniquement** après F stable + décision SEO | Commit séparé | F PASS |

### Rollback

- **Front :** restaurer backup `/var/www/xnosweet` précédent ; `nginx reload`.
- **Nginx :** désactiver `sites-enabled/sweetcraft…` ; reload.
- **DNS :** supprimer enregistrement `sweetcraft` (propagation).
- **Cert :** laisser ou révoquer selon politique Certbot (hors scope auto).
- **Git :** pas de revert forcé ; nouveau commit correctif si besoin.

---

## 7 — Matrice

| Point | Verdict |
|-------|---------|
| Git scope clarifié | **PASS** (evidence) |
| Frontend 13B/13D code present (WIP) | **PASS** local / **BLOCKED** deploy until committed |
| Live VPS Nginx/Certbot detail | **UNKNOWN** (no SSH) |
| DNS apex | **PASS** (87.106.2.194) |
| DNS sweetcraft | **BLOCKED** (NXDOMAIN) |
| Nginx subdomain | **BLOCKED** (not created ; template only) |
| TLS subdomain | **UNKNOWN**/BLOCKED until E |
| API/media pattern | **PASS** (doc + live apex) |
| SEO cutover flag false | **PASS** |
| Apex regression risk | **PASS** if same SPA + smoke F |
| Other VPS services | **UNKNOWN** |
| Rollback plan | **PASS** (documented) |
| Player download (GitHub) | **PASS** (public ; independent of subdomain) |

---

## Décisions humaines exactes (Kevin)

1. Option source **A / B / C** (portail seul vs + CS V2).  
2. Approuver commit/push des seuls fichiers 13B+13D.  
3. Approuver fenêtre VPS : DNS IONOS + Nginx + Certbot + copy front.  
4. Confirmer IP encore `87.106.2.194` avant DNS.  
5. Ne **pas** activer cutover canonical avant smoke F.

---

Explicit: **NO COMMIT / PUSH / DNS / NGINX / CERTBOT / VPS CHANGE / DEPLOY / CANONICAL CUTOVER.**
