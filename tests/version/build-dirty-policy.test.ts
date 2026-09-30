/**
 * PACK-10.1SYNC-13D.1 — build provenance dirty classification.
 * Pure porcelain/path policy tests (no live worktree mutation).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNonProductAuditPath,
  isVersionGenerateOutputPath,
  isWorktreeProductDirtyFromPorcelain,
  normalizeRepoRelPath,
  parseGitPorcelainLine
} from "../../scripts/version/lib.mts";

describe("build provenance dirty policy", () => {
  it("clean porcelain → not dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain(""), false);
    assert.equal(isWorktreeProductDirtyFromPorcelain("\n\n"), false);
  });

  it("tracked source modification → dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain(" M src/instance/apply/index.ts\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("M  package.json\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("MM desktop/main/lifecycle.ts\n"), true);
  });

  it("tracked deletion → dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain(" D src/build.ts\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("D  scripts/version/lib.mts\n"), true);
  });

  it("relevant untracked source file → dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? src/instance/firstRun/seed.ts\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? ui/src/app/core/services/auth-play-convergence.ts\n"), true);
  });

  it("relevant untracked config/build file → dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? electron-builder.yml\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? tsconfig.json\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? scripts/version/extra.mts\n"), true);
  });

  it("only docs/audits/** untracked → not dirty", () => {
    assert.equal(
      isWorktreeProductDirtyFromPorcelain("?? docs/audits/\n"),
      false
    );
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        "?? docs/audits/PACK-10.1SYNC-13A-wip-consolidation.md\n"
      ),
      false
    );
  });

  it("docs/audits alone with path separators variants → not dirty", () => {
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        "?? docs\\audits\\PACK-10.1SYNC-13A-wip-consolidation.md\n"
      ),
      false
    );
    assert.equal(normalizeRepoRelPath("docs\\audits\\x.md"), "docs/audits/x.md");
    assert.equal(isNonProductAuditPath("docs\\audits\\x.md"), true);
    assert.equal(isNonProductAuditPath("./docs/audits/x.md"), true);
  });

  it("broad docs/** is NOT excluded — untracked docs outside audits → dirty", () => {
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? docs/VERSIONING.md\n"), true);
    assert.equal(isWorktreeProductDirtyFromPorcelain("?? docs/other/note.md\n"), true);
    assert.equal(isNonProductAuditPath("docs/VERSIONING.md"), false);
  });

  it("audit + relevant dirt → dirty", () => {
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        "?? docs/audits/PACK-10.1SYNC-13A-wip-consolidation.md\n M src/application/orchestrator/status.ts\n"
      ),
      true
    );
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        "?? docs/audits/\n?? src/new-module.ts\n"
      ),
      true
    );
  });

  it("rename involving product path → dirty; audit-only rename → not dirty", () => {
    assert.equal(
      isWorktreeProductDirtyFromPorcelain("R  src/a.ts -> src/b.ts\n"),
      true
    );
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        "R  docs/audits/old.md -> docs/audits/new.md\n"
      ),
      false
    );
  });

  it("version:generate output dirt alone does not mark product dirty", () => {
    assert.equal(isVersionGenerateOutputPath("src/build.generated.ts"), true);
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(" M src/build.generated.ts\n"),
      false
    );
    assert.equal(
      isWorktreeProductDirtyFromPorcelain(
        " M src/build.generated.ts\n M desktop/shared/build.generated.ts\n M src/version.generated.ts\n"
      ),
      false
    );
  });

  it("parseGitPorcelainLine normalizes separators", () => {
    const e = parseGitPorcelainLine("?? docs\\audits\\note.md");
    assert.ok(e);
    assert.equal(e.xy, "??");
    assert.deepEqual(e.paths, ["docs/audits/note.md"]);
  });
});
