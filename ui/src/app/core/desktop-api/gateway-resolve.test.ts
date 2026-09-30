import assert from "node:assert/strict";
import test from "node:test";
import { resolveGateway } from "./gateway-resolve.js";

test("production + preload → electron gateway", () => {
  const g = resolveGateway({ production: true, hasPreload: true, forceDev: false });
  assert.equal(g.kind, "electron");
  assert.equal(g.constructor.name, "ElectronLauncherDesktopGateway");
});

test("production + missing preload → fail closed (never Dev)", () => {
  const g = resolveGateway({ production: true, hasPreload: false, forceDev: true });
  assert.equal(g.kind, "electron");
  assert.equal(g.constructor.name, "DesktopBridgeUnavailableGateway");
  assert.notEqual(g.constructor.name, "DevLauncherDesktopGateway");
});

test("development browser + no preload → Dev gateway allowed", () => {
  const g = resolveGateway({ production: false, hasPreload: false });
  assert.equal(g.kind, "dev");
});

test("forced dev fixture in production ignored", () => {
  const g = resolveGateway({ production: true, hasPreload: true, forceDev: true });
  assert.equal(g.constructor.name, "ElectronLauncherDesktopGateway");
});
