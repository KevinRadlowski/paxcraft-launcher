/** One-shot first-run seed ids recorded in instance state. */
export const FIRST_RUN_SEED_OPTIONS = "mc-options-firstrun" as const;
export const FIRST_RUN_SEED_SERVERS = "mc-servers-sweetcraft" as const;

export const SWEETCRAFT_SERVER_NAME = "SweetCraft" as const;
export const SWEETCRAFT_SERVER_ADDRESS = "sweetcraft.datho.st" as const;

/** Vanilla Minecraft default language — treated as first-run placeholder when seed not yet applied. */
export const MINECRAFT_DEFAULT_LANG = "en_us" as const;
export const SWEETCRAFT_DEFAULT_LANG = "fr_fr" as const;

export const OPTIONS_REL_PATH = "options.txt" as const;
export const SERVERS_REL_PATH = "servers.dat" as const;
