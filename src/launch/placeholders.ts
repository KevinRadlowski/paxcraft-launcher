import { ErrorCode, LauncherError } from "../core/errors/index.js";

/**
 * Strict placeholder set for Minecraft modern argument templates.
 * Unknown remaining placeholders → UNKNOWN_LAUNCH_PLACEHOLDER (fail closed).
 */
export const KNOWN_LAUNCH_PLACEHOLDERS = [
  "auth_player_name",
  "version_name",
  "game_directory",
  "assets_root",
  "assets_index_name",
  "auth_uuid",
  "auth_access_token",
  "user_type",
  "version_type",
  "natives_directory",
  "launcher_name",
  "launcher_version",
  "classpath",
  "classpath_separator",
  "library_directory",
  "user_properties",
  "profile_properties",
  "resolution_width",
  "resolution_height",
  "clientid",
  "auth_xuid"
] as const;

export type KnownLaunchPlaceholder = (typeof KNOWN_LAUNCH_PLACEHOLDERS)[number];

export type PlaceholderValues = Record<KnownLaunchPlaceholder, string>;

const PLACEHOLDER_RE = /\$\{([a-zA-Z0-9_]+)\}/g;

export const SENSITIVE_PLACEHOLDERS: ReadonlySet<string> = new Set(["auth_access_token"]);

export function substitutePlaceholders(template: string, values: PlaceholderValues): string {
  return template.replace(PLACEHOLDER_RE, (match, name: string) => {
    if (!(name in values)) {
      throw new LauncherError(ErrorCode.UNKNOWN_LAUNCH_PLACEHOLDER, `unknown placeholder: ${name}`, {
        placeholder: name,
        template: redactTemplateForError(template)
      });
    }
    return values[name as KnownLaunchPlaceholder];
  });
}

/** After substitution, any leftover ${...} is a bug / unknown → fail. */
export function assertNoUnresolvedPlaceholders(value: string): void {
  const left = value.match(PLACEHOLDER_RE);
  if (left && left.length > 0) {
    throw new LauncherError(ErrorCode.UNKNOWN_LAUNCH_PLACEHOLDER, "unresolved placeholder remaining", {
      placeholders: left
    });
  }
}

function redactTemplateForError(template: string): string {
  return template.replace(/\$\{auth_access_token\}/g, "${auth_access_token}");
}

export function redactSensitiveInString(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (!secret) continue;
    if (out.includes(secret)) {
      out = out.split(secret).join("<redacted>");
    }
  }
  return out;
}
