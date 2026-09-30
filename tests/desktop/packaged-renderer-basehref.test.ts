/**
 * PACK-07A — packaged Angular renderer must use relative baseHref under Electron file://.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_GENERATED = path.join(
  ROOT,
  "ui",
  "dist",
  "sweetcraft-launcher-ui",
  "browser",
  "index.html"
);
const ANGULAR_JSON = path.join(ROOT, "ui", "angular.json");

function extractBaseHref(html: string): string | null {
  const m = html.match(/<base\s+href\s*=\s*["']([^"']+)["']\s*\/?>/i);
  return m?.[1] ?? null;
}

/** Deterministic clean-checkout path: build ignored ui/dist when absent (never require stale local output). */
function ensurePackagedRendererIndexBuilt(): void {
  if (fs.existsSync(INDEX_GENERATED)) return;
  execSync("pnpm --dir ui run build", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NG_CLI_ANALYTICS: "false", CI: "true" }
  });
  assert.ok(
    fs.existsSync(INDEX_GENERATED),
    `renderer build did not produce ${INDEX_GENERATED}`
  );
}

function extractResourceRefs(html: string): string[] {
  const refs: string[] = [];
  const re =
    /(?:src|href)\s*=\s*["']([^"']+\.(?:js|css))["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

describe("PACK-07A packaged Angular baseHref", () => {
  it("A. production build config forces relative baseHref ./", () => {
    const raw = fs.readFileSync(ANGULAR_JSON, "utf8");
    const cfg = JSON.parse(raw) as {
      projects: {
        "sweetcraft-launcher-ui": {
          architect: {
            build: {
              defaultConfiguration?: string;
              configurations: {
                production: { baseHref?: string };
                development: { baseHref?: string };
              };
            };
          };
        };
      };
    };
    const build = cfg.projects["sweetcraft-launcher-ui"].architect.build;
    assert.equal(build.defaultConfiguration, "production");
    assert.equal(build.configurations.production.baseHref, "./");
    assert.equal(build.configurations.development.baseHref, "/");
  });

  it(
    "B. generated packaged index.html uses ./ and relative asset refs",
    { timeout: 300_000 },
    () => {
    ensurePackagedRendererIndexBuilt();
    const html = fs.readFileSync(INDEX_GENERATED, "utf8");
    const base = extractBaseHref(html);
    assert.equal(base, "./", `expected <base href="./">, got ${JSON.stringify(base)}`);
    assert.doesNotMatch(html, /<base\s+href\s*=\s*["']\/["']/i);

    const refs = extractResourceRefs(html);
    assert.ok(refs.length >= 2, `expected script/style refs, got ${refs.length}`);
    for (const ref of refs) {
      assert.ok(!ref.startsWith("/"), `root-absolute ref forbidden in packaged index: ${ref}`);
      assert.ok(!/^https?:\/\//i.test(ref), `unexpected remote ref: ${ref}`);
      assert.ok(
        !ref.includes("file:///"),
        `file URL must not be baked into index: ${ref}`
      );
      // Relative to browser/ directory (./foo or foo)
      assert.match(ref, /^(?:\.\/)?[A-Za-z0-9._-]+\.(?:js|css)$/);
    }

    const browserDir = path.dirname(INDEX_GENERATED);
    for (const ref of refs) {
      const rel = ref.replace(/^\.\//, "");
      const abs = path.join(browserDir, rel);
      assert.ok(fs.existsSync(abs), `packaged resource missing next to index: ${rel}`);
    }
    }
  );
});
