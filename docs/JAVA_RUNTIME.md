# Java Runtime

## Requirement source

`JavaRequirement.majorVersion` is read from Minecraft version metadata
(`javaVersion.majorVersion`), inherited through the version graph and merged
into the Fabric runtime plan.

Compatibility rule: **discovered major ≥ required major**.

For SweetCraft 0.1.3 / Minecraft 26.1.2 the tip currently requires **major ≥ 25**.

## Selection policy (PACK-06)

1. Compatible **managed** runtime under `<runtimeRoot>/java/runtimes/<identity>/`
2. Else compatible **JAVA_HOME** / **PATH** / extra candidates (unless
   `SWEETCRAFT_JAVA_SKIP_SYSTEM=1`)
3. Else **provision** Eclipse Temurin (Adoptium) GA JDK ZIP for Windows x64
4. Re-probe and use managed binary

Managed layout:

```
<runtimeRoot>/
  java/runtimes/
    temurin-<major>-windows-x64/
      .sweetcraft-managed-java.json
      jdk-…/bin/java.exe   (or bin/java.exe)
    .provision.lock.json   (transient)
    .staging/              (transient)
```

Provider: `https://api.adoptium.net` — HTTPS metadata + package SHA-256 required.
Download uses the hardened `DownloadEngine` + `FetchByteSource`.
Extraction uses `extractZipSecure` (Zip Slip refused) into staging, then atomic
rename activation.

No PATH / JAVA_HOME system mutation. No write into the install directory.
