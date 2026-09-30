# PACK-13C — PUBLIC REPO SECURITY GATE

**STATUS:** `VISIBILITY_GATE_BLOCKED` — scans secrets **PASS** ; ouverture publique **non autorisée** tant que les actions humaines critiques ci-dessous ne sont pas faites.

**Date:** 2026-09-22  
**Invariant:** NO COMMIT / PUSH / TAG / RELEASE EDIT / PUBLIC VISIBILITY CHANGE / DNS / DEPLOY.

---

## STARTING_HEAD / ENDING_HEAD

| Champ | Valeur |
|-------|--------|
| HEAD | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| ENDING_HEAD | **identique** (pas de commit) |
| Branche | `main` = `origin/main` (ahead/behind **0/0**) |
| origin | `https://github.com/KevinRadlowski/SweetCraft-Launcher.git` |
| Visibilité | **PRIVATE** (confirmé `gh repo view`) |
| Worktree | WIP **untracked** `docs/audits/**` préservé ; **modifié** `README.md` ; **nouveau** `NOTICE` (non commités) |

Tag annoté `v0.6.0-rc.18` → commit `c203dc0…` (peel vérifié). Assets Release **non modifiés**.

---

## A — Inventaire Git

### Refs distantes (publication)

| Ref | Tip | Notes |
|-----|-----|-------|
| `origin/main` | `c203dc0` | Canonique |
| `origin/legacy-public-readme` | `686e0dc` | **Orphan** (2 commits : `e972320` → `686e0dc`) ; **uniquement** `README.md` |
| `refs/tags/v0.6.0-rc.18` | tag → `c203dc0` | RC publiée |

### Refs locales non distantes

| Ref | Tip |
|-----|-----|
| `refs/ci-snapshots/sweetcraft-launcher-step4-3` | `9871f4e` |
| `refs/ci-snapshots/sweetcraft-launcher-step4-3-clean02` | `062f82d` |

→ Ne seront **pas** publiées tant qu’elles ne sont pas poussées. **Ne pas** les pousser.

### Historique atteignable

- `git rev-list --all` = **32** commits (main lineage + orphan 2 + snapshots inclus dans le compte all local).
- Orphan **audité intégralement** (2 blobs `README.md` seulement).

### Orphan — risques publication (pas de secrets)

Contenu obsolète / trompeur si visible publiquement :

- « public repository » / formulation type dépôt déjà public ;
- « independent community project » vs décision **propriétaire** ;
- liste « Planned features » marketing ;
- mentions privacy/secrets génériques (pas de valeur secrète).

**Recommandation Kevin (manuelle) :** supprimer la branche distante `legacy-public-readme` **avant** le passage en public (cette gate n’a **pas** supprimé de ref).  
Alternative : accepter explicitement le risque résiduel (non recommandé).

### Fichiers sensibles HEAD

- Aucun chemin tracked `.env` / credentials / `.pem` privés / dumps (inventory `git ls-files`).
- `config/trusted-keys.json` : clés **publiques** uniquement (commentaire anti-secret).
- Binaires HEAD : icônes / webp UI (14 fichiers inventoriés, tailles only) — pas d’exe tracked.

---

## B — Secrets (scans)

### Scan principal — **COMPLETED**

| Champ | Valeur |
|-------|--------|
| Méthode | `git grep -I -n -E` sur **tous** les commits de `git rev-list --all` (32) |
| Script | `_tmp_pack13c_scan.mjs` (exécuté puis **supprimé** ; pas laissé en WIP) |
| `COMMIT_LIST_SHA256` | `4bb0958c6837f8de8e82f9867916f905475f9c1e40c5d8611c07a3049823580a` |
| Durée | ~16 s ; `SCAN_STATUS=COMPLETED` |
| Patterns | PRIVATE_KEY_PEM, ghp_, github_pat_, AKIA, CURSEFORGE_API_KEY=, CF_API_KEY=, Slack xox*, JWT-like, basic-auth URL, Azure AccountKey |
| Hits totaux | **0** |
| Orphan (2 commits) | **0** hit sur les mêmes patterns |

### Limites (UNKNOWN ≠ PASS pour ces axes)

- Contenu **non textuel** / binaires : inventaire tailles/noms seulement ; pas de strings dump d’images.
- Secrets **jamais** commités (machine locale, chat, CI logs hors git) : **NON DÉTERMINABLE**.
- Protection rules Environment `player-release` : rules vides ; `can_admins_bypass: true` — OK pour private ; à revoir en public (pas un secret leak).

### Actions / secrets métadonnées

| Item | Résultat |
|------|----------|
| `gh secret list` (repo) | **vide** |
| `gh secret list --env player-release` | **vide** |
| Environment `player-release` | existe ; pas de secrets nommés listés |
| Workflows | `ci-main` / `ci-pr` : `contents: read` ; `player-release` : job `contents: write` + environment ; **aucun** `secrets.*` dans les YAML |
| Actions permissions | enabled, `allowed_actions: all`, sha pinning off |

### CurseForge

| Distinction | Verdict |
|-------------|---------|
| Fuite **dans** l’historique Git inspecté | **Aucune** (`CURSEFORGE_API_KEY=` / `CF_API_KEY=` : 0) |
| Fuite **hors** Git (env locale, Pack Manager, chat) | **UNKNOWN** |

**Action Kevin requise :** confirmer si une clé CurseForge a jamais été partagée / exposée hors Git ; si oui → **rotation/révocation** avant ou en parallèle de l’ouverture publique.  
Pas de réécriture d’historique proposée (non nécessaire sur findings Git).

---

## C — README / NOTICE

Fichiers préparés (**WIP, non commités**) :

| Fichier | Rôle |
|---------|------|
| `README.md` | RC 0.6.0-rc.18, Windows x64, install, Microsoft, modpack, préversion, unsigned/SmartScreen, MAJ manuelle, portail futur non déployé, propriété |
| `NOTICE` | Notice **propriétaire** ; pas MIT/GPL/Apache/CC ; source visible ≠ licence ; tiers exclus |

**Validation humaine manquante :**

- Nom légal exact du titulaire de droits dans `NOTICE` (« Kevin Radlowski » — à confirmer / ajuster).
- Inventaire d’attribution mods / deps : partiel → documenté comme expansible / UNKNOWN pour exhaustivité.

---

## D — Intégrité Release (lecture seule)

| Check | Résultat |
|-------|----------|
| Repo PRIVATE | Oui |
| Release `v0.6.0-rc.18` | Publiée, **prerelease**, non-draft |
| Tag → commit | `c203dc0f077235b430bf200327fdcea3ea5aa542` |
| Asset setup | `SweetCraft.Launcher-0.6.0-rc.18-win-x64-setup.exe` ; size **85858329** ; digest **sha256:080047ecdeb80a9c0a83b768e9c8f1a44f38696929f4ecf9b6717d0bd155524d** |
| Manifeste | `buildCommit` / `sha256` / `sizeBytes` **alignés** ; `signing.status: unsigned` ; `channel: rc` |
| Download non auth | **404** (attendu tant que PRIVATE) |

### Checklist anonyme post-publication (Kevin, après public)

1. Page repo HTTP 200 sans login.  
2. Page Release `v0.6.0-rc.18` visible.  
3. GET setup + manifeste **sans** compte → 200.  
4. `Get-FileHash` setup = `080047ec…524d` ; size = 85858329.  
5. Manifeste JSON lisible ; mêmes chiffres.

**Non exécuté ici** (repo encore privé) — ne pas revendiquer de test public.

---

## E — Matrice GATE

| Point | Verdict | Note |
|-------|---------|------|
| HEAD secrets (patterns) | **PASS** | 0 hit |
| Historique reachable text scan | **PASS** | 32 commits, scan COMPLETED |
| Orphan secrets | **PASS** | 0 hit |
| Orphan messaging / IP risk | **BLOCKED** | Branche distante trompeuse ; suppression manuelle recommandée |
| Binaires tracked | **PASS** | Assets UI only |
| Actions / Environments secrets | **PASS** | listes vides ; perms documentées |
| README / NOTICE | **PASS** (contenu préparé) | WIP non commité — Kevin doit committer avant ou avec l’ouverture |
| Droits tiers exhaustifs | **UNKNOWN** | NOTICE + caveat ; pas de LICENSE OSS |
| CurseForge hors-Git | **UNKNOWN** | Confirmation humaine |
| Release integrity | **PASS** | Lecture seule |
| Périmètre visibilité (xnosweet / PM restent privés) | **PASS** (rappel) | Hors scope mutation |
| Test download anonyme | **UNKNOWN** | Impossible tant que PRIVATE |

### Décision

**`READY_FOR_HUMAN_VISIBILITY_CHANGE` = NON**

Conditions minimales avant GO humain :

1. Kevin : supprimer (ou accepter formellement) `origin/legacy-public-readme`.  
2. Kevin : confirmation CurseForge hors-Git (OK / rotation faite).  
3. Kevin : valider texte `NOTICE` (titulaire) + **committer** `README.md` + `NOTICE` sur `main` (hors scope de ce pack).  
4. Puis seulement : Settings → Change visibility → Public.  
5. Exécuter checklist anonyme §D.

---

## Actions Kevin (manuel)

1. Relire `README.md` + `NOTICE` (WIP).  
2. Confirmer / ajuster le titulaire copyright.  
3. Confirmer statut clé CurseForge (hors Git).  
4. Supprimer la branche distante `legacy-public-readme` (UI GitHub ou `git push origin --delete legacy-public-readme`) — **après** son OK ; pas fait ici.  
5. Commit + push des fichiers publics (README/NOTICE) quand prêt.  
6. Changer la visibilité en **Public**.  
7. Smoke download anonyme §D.  
8. Ne **pas** publier `xnosweet` ni Pack Manager.

---

## Fichiers touchés ce pack

- `README.md` (remplacé)
- `NOTICE` (créé)
- `docs/audits/PACK-13C-public-repo-security-gate.md` (ce fichier)
- Scan temporaire créé puis **supprimé**

WIP audits antérieurs : **préservés**.

---

Explicit: **NO COMMIT / PUSH / TAG / RELEASE EDIT / PUBLIC VISIBILITY CHANGE / DNS CHANGE / DEPLOY.**
