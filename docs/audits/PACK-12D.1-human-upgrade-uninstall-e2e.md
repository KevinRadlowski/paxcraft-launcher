# PACK-12D.1 — HUMAN E2E (safe) : install-over / uninstall

**Statut HUMAN E2E :** `FULL PASS` (PACK-12D.2 — `kevin\sweetcraft-e2e`)  
**Record :** `docs/audits/PACK-12D.2-human-e2e-closure.md`

**Lot packaging :** HEAD `5938ab3897249fe6ee13d8c3b15fbd252cd05f49`  
**Checklist corrigée :** PACK-12D.1 (protocole ; résultats dans 12D.2).

---

## RÈGLES DURES (lire avant tout)

1. **Une seule installation de test active à la fois.**  
   Même `appId` (`fr.xbase.sweetcraft.launcher`) + `perMachine: false` → **une** entrée désinstallation HKCU, **un** produit Windows.  
   Des dossiers d’install différents **n’isolent pas** le produit Windows.

2. **Le profil Windows live de Kevin est INTERDIT** pour installer / désinstaller / lancer le Launcher de test.  
   `%APPDATA%\SweetCraft Launcher` du compte live = données prod (auth, settings, instance par défaut).

3. **Isolation filesystem ≠ isolation NSIS/registry.**  
   Installer sous `_e2e-12d\install\` isole seulement les binaires.  
   Registry uninstall + AppData restent ceux du **compte Windows qui exécute le setup**.

4. **Aucun cleanup automatique** de chemins ambigus (`%APPDATA%`, Program Files, Desktop).  
   Cleanup = uniquement les racines listées §0 **après** PASS/STOP documenté.

5. **STOP immédiat** si :
   - session = compte Windows de production Kevin ;
   - le setup propose un chemin d’install hors `_e2e-12d\install\` ;
   - doute sur previous vs current setup ;
   - Shortcuts / Apps list montrent une 2ᵉ SweetCraft Launcher non prévue ;
   - besoin de credentials Microsoft / mondes live.

---

## Isolation requise (prérequis HUMAN)

### Verdict PACK-12D.1

| Méthode | AppData | HKCU uninstall | Suffisant ? |
|---------|---------|----------------|-------------|
| Dossier install différent seul | Non (même `%APPDATA%\…`) | Non (même `appId`) | **NON** |
| `--user-data-dir` au lancement | Oui (si utilisé) | Non (setup/uninstall inchangés) | **NON** pour C/D uninstall |
| **Compte Windows local jetable** | Oui | Oui (`perMachine: false`) | **OUI** (minimum) |
| **VM jetable + snapshot** | Oui | Oui | **OUI** (recommandé) |

**Prérequis accepté pour démarrer A–E :**  
compte Windows **local jetable dédié E2E** (ex. `sc-e2e-12d`) **ou** VM jetable.  
Sans l’un des deux → **BLOCKED** (ne pas exécuter).

Création compte local (exemple, admin) :

```powershell
# Sur la machine hôte — ne pas toucher le profil Kevin
net user sc-e2e-12d * /add
# Puis se déconnecter / ouvrir session sc-e2e-12d uniquement pour ce lot
```

Sous ce compte : **aucune** instance SweetCraft prod, **aucun** credential Microsoft requis pour A–E (lancement About/diagnostics optionnel sans login).

---

## 0. Préparation (sous compte / VM jetable uniquement)

### Chemins (hôte — copies d’artefacts OK depuis Kevin)

```text
H:\Users\kevin\Downloads\Dev\XBase\LAUNCHER\_e2e-12d\
  setups\
    PREVIOUS-0.6.0-rc.18@62e18bdef8b2-win-x64-setup.exe
    CURRENT-0.6.0-rc.18@5938ab389724-win-x64-setup.exe
    CURRENT-manifest.json
    PREVIOUS-manifest-62e18bd.json
    hashes.txt
  install\                 ← UNIQUE dossier d’installation de test
  instance-custom\         ← marqueur custom (scénario D)
  evidence\
  userdata-scratch\        ← notes seulement ; PAS le userData Electron réel
```

Le userData Electron du compte jetable sera :

```text
C:\Users\sc-e2e-12d\AppData\Roaming\SweetCraft Launcher\
```

**Ce n’est pas** `C:\Users\kevin\AppData\Roaming\SweetCraft Launcher\`.

### Identification previous / current

| Rôle | Fichier | buildId | buildCommit | SHA-256 |
|------|---------|---------|-------------|---------|
| **PREVIOUS** | `PREVIOUS-0.6.0-rc.18@62e18bdef8b2-win-x64-setup.exe` | `0.6.0-rc.18@62e18bdef8b2` | `62e18bdef8b22a8f001d2c04980b815f5027bb58` | `44ab8ded8013a0dc06885891910b808c1e0deb520e2a6dd6c5056962461fa577` |
| **CURRENT** | `CURRENT-0.6.0-rc.18@5938ab389724-win-x64-setup.exe` | `0.6.0-rc.18@5938ab389724` | `5938ab3897249fe6ee13d8c3b15fbd252cd05f49` | `73cde6863a48d36e80cb3eb2971a6cdf919a9b06554341b818d3d3fdd37d9d13` |

**rc.17 n’est pas un « previous build »** pour le scénario B same-SemVer — c’est un autre SemVer (hors matrice B).

Vérif hashes :

```powershell
Get-FileHash -Algorithm SHA256 `
  "H:\Users\kevin\Downloads\Dev\XBase\LAUNCHER\_e2e-12d\setups\PREVIOUS-*.exe",`
  "H:\Users\kevin\Downloads\Dev\XBase\LAUNCHER\_e2e-12d\setups\CURRENT-*.exe" |
  Tee-Object "H:\Users\kevin\Downloads\Dev\XBase\LAUNCHER\_e2e-12d\setups\hashes.txt"
```

### Avant A

- [ ] Session = compte jetable / VM (pas Kevin)
- [ ] Apps Windows : **aucune** SweetCraft Launcher installée sur **ce** compte (sinon désinstaller d’abord **sur ce compte seulement**)
- [ ] Fermer tout SweetCraft Launcher
- [ ] `install\` vide ou prêt à recevoir **une** install

---

## Ordre d’exécution (obligatoire)

`préparation → A → B → (désinstaller test) → C → D → E → diagnostics`

Ne pas paralléliser A/B/C/D. Après B, **désinstaller** l’app de test (compte jetable) avant C.

---

## A. SAME VERSION install-over (CURRENT → CURRENT)

1. Lancer **CURRENT** setup. Dossier install = `_e2e-12d\install\` uniquement.
2. Finir l’assistant. Noter exe présent.
3. Relancer **le même CURRENT** setup → install-over même dossier.
4. Attendu : succès NSIS ; `install\` contient toujours le Launcher.

| Résultat | ☐ PASS / ☐ FAIL / ☐ STOP |
| Evidence | `evidence\A.txt` + hash CURRENT |

---

## B. NEWER BUILD install-over (PREVIOUS → CURRENT)

Même SemVer `0.6.0-rc.18`, builds différents. NSIS peut **ne pas** traiter ça comme upgrade versionnelle — noter le comportement réel.

1. Si PREVIOUS absent / hash mismatch → **SKIP/BLOCKED** (pas PASS).
2. Sinon : désinstaller install de A si encore présente (**compte jetable**).
3. Installer **PREVIOUS** → `_e2e-12d\install\`.
4. (Optionnel) Lancer exe avec About : Build = `0.6.0-rc.18@62e18bdef8b2`.
5. Installer **CURRENT** par-dessus le **même** dossier.
6. About : Build = `0.6.0-rc.18@5938ab389724`.

| Résultat | ☐ PASS / ☐ FAIL / ☐ SKIP / ☐ STOP |
| buildId avant / après | |

---

## C. WINDOWS UNINSTALL

1. Une install CURRENT active sous `_e2e-12d\install\` (sinon réinstaller CURRENT).
2. Optionnel : créer `marker.txt` sous  
   `%APPDATA%\SweetCraft Launcher\` **du compte jetable** (pas Kevin).
3. Paramètres → Applications → désinstaller **SweetCraft Launcher**.
4. Attendu :
   - dossier `install\` / raccourcis de test retirés ;
   - `%APPDATA%\SweetCraft Launcher\` **conservé** (`deleteAppDataOnUninstall: false`).

| Résultat | ☐ PASS / ☐ FAIL / ☐ STOP |
| AppData conservé | ☐ oui / ☐ non |

---

## D. CUSTOM INSTANCE survit à uninstall

1. Réinstaller CURRENT → `_e2e-12d\install\`.
2. Créer `_e2e-12d\instance-custom\MARKER-12D.txt` = `KEEP`.
3. Si Settings permet de pointer l’instance vers ce dossier **sans** toucher une instance live : le faire.  
   Sinon : preuve filesystem seule (marqueur hors install) + noter « pas de reconfig Settings ».
4. Désinstaller Windows (compte jetable).
5. Attendu : `MARKER-12D.txt` toujours `KEEP`.

| Résultat | ☐ PASS / ☐ FAIL / ☐ STOP |

---

## E. RUNNING APP pendant setup

1. Install CURRENT ; lancer le Launcher (compte jetable).
2. Sans force-kill prod : relancer CURRENT setup vers le même `install\`.
3. Noter : message fermeture / échec / overwrite.

| Résultat | ☐ OBSERVÉ / ☐ NON DÉTERMINABLE / ☐ STOP |
| Comportement | |

---

## F. DOWNGRADE

Politique joueur : **non supporté**. Ne pas tester sauf besoin explicite.  
Sinon : **NON DÉTERMINABLE** + politique conservée.

---

## Diagnostics (après un run isolé)

1. About : Version + Build = CURRENT `buildId`.
2. Copier diagnostics : `Build ID` / `Build commit` présents ; **pas** de `accessToken` / `refreshToken`.

| About OK | ☐ | Clipboard OK | ☐ | Secrets absents | ☐ |

---

## Recovery / STOP

| Situation | Action |
|-----------|--------|
| Setup lancé sous Kevin par erreur | **STOP**. Ne pas désinstaller. Noter. Demander revue. |
| Uninstall a retiré la mauvaise entrée | **STOP**. Ne pas « réparer » à l’aveugle. |
| AppData Kevin modifié | **STOP**. Pas de `Remove-Item` AppData. Backup si existe. |

## Cleanup (uniquement racines connues)

Sous compte jetable, après evidence capturée :

```powershell
# UNIQUEMENT ces racines — JAMAIS AppData de Kevin
Remove-Item -Recurse -Force "H:\Users\kevin\Downloads\Dev\XBase\LAUNCHER\_e2e-12d\install" -ErrorAction SilentlyContinue
# Optionnel : désinstaller SweetCraft Launcher via Apps (compte jetable)
# Optionnel : supprimer le compte sc-e2e-12d après revue
```

**Ne jamais** `Remove-Item` sur `C:\Users\kevin\AppData\Roaming\SweetCraft Launcher`.

---

## Synthèse

| Scénario | Statut |
|----------|--------|
| Prérequis isolation | **PASS** — compte `kevin\sweetcraft-e2e` |
| A | **PASS** (HUMAN_VERIFIED) |
| B | **PASS** (HUMAN_VERIFIED) |
| C | **PASS** (HUMAN_VERIFIED) |
| D | **PASS** (HUMAN_VERIFIED) |
| E | **PASS** (HUMAN_VERIFIED) |
| F | NOT TESTED (politique unsupported) |
| Diagnostics | **PASS** (HUMAN_VERIFIED) |
| **HUMAN global** | **FULL PASS** — see PACK-12D.2 |
