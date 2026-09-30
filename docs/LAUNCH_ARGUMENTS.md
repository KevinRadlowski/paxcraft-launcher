# Launch Arguments

## Moderne (`arguments.jvm` / `arguments.game`)

Entrées : `string` ou `{ rules, value: string | string[] }`.

- Ordre metadata préservé
- Rules via Rule Engine existant + `LaunchFeatures`
- Placeholders stricts uniquement (liste connue)
- Placeholder inconnu → `UNKNOWN_LAUNCH_PLACEHOLDER`

## Legacy `minecraftArguments`

**Non supporté** pour la cible SweetCraft moderne.  
→ `UNSUPPORTED_LAUNCH_METADATA` (pas de split approximatif).

## Placeholders supportés

`auth_player_name`, `version_name`, `game_directory`, `assets_root`, `assets_index_name`, `auth_uuid`, `auth_access_token`, `user_type`, `version_type`, `natives_directory`, `launcher_name`, `launcher_version`, `classpath`, `classpath_separator`, `library_directory`, `user_properties`, `profile_properties`, `resolution_width`, `resolution_height`, `clientid`, `auth_xuid`.

## Assemblage JVM

1. Args mémoire Launcher (`-Xms` / `-Xmx`) — **priorité**
2. `extraJvmArgs` Launcher
3. Metadata JVM (les `-Xms`/`-Xmx` metadata sont **filtrés**)

Le classpath vient des metadata (`-cp` + `${classpath}`), sans second `-cp` inventé.

## Features (défaut = false)

`has_custom_resolution`, `is_demo_user`, `has_quick_plays_support`, `is_quick_play_*`.

Résolution custom : width/height entiers 320–7680 uniquement si feature activée.
