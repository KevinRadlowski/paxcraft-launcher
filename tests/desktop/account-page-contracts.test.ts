/**
 * 0.6F.3 V3 Account page source contracts (desktop suite — may use node:fs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  path.join(root, "ui/src/app/features/account/account.page.ts"),
  "utf8",
);
const homeSource = readFileSync(
  path.join(root, "ui/src/app/features/home/home.page.ts"),
  "utf8",
);
const frJson = JSON.parse(
  readFileSync(path.join(root, "ui/src/assets/i18n/fr.json"), "utf8"),
) as Record<string, string>;
const productLinks = readFileSync(
  path.join(root, "ui/src/app/core/product-links.ts"),
  "utf8",
);
const modalServiceSource = readFileSync(
  path.join(root, "ui/src/app/core/services/modal.service.ts"),
  "utf8",
);

describe("0.6F.3 V3 Account page source contracts", () => {
  it("CONNECTED requires AUTHENTICATED + active account", () => {
    assert.match(pageSource, /isAuthenticated\(this\.authState\(\)\) && this\.active\(\) != null/);
  });

  it("DISCONNECTED empty identity + Microsoft login wiring", () => {
    assert.match(pageSource, /identity-empty/);
    assert.match(pageSource, /account\.identity\.empty_body/);
    assert.match(pageSource, /cta\.sign_in_microsoft/);
    assert.match(pageSource, /void this\.auth\.login\(\)/);
  });

  it("registered accounts iterate store.accounts only — no mockup names", () => {
    assert.match(pageSource, /@for \(account of store\.accounts\(\)/);
    assert.doesNotMatch(pageSource, /BuilderKing|Explorateur42|JoueurDemo/);
  });

  it("zero registered accounts empty state", () => {
    assert.match(pageSource, /store\.accounts\(\)\.length === 0/);
    assert.match(pageSource, /account\.empty/);
    assert.equal(frJson["account.empty"], "Aucun compte enregistré.");
  });

  it("active indication uses Actif / Disponible badges", () => {
    assert.match(pageSource, /account\.badge\.active/);
    assert.match(pageSource, /account\.badge\.available/);
    assert.equal(frJson["account.badge.active"], "Actif");
    assert.equal(frJson["account.badge.available"], "Disponible");
  });

  it("logout / login / add / select wire AuthActionsService", () => {
    assert.match(pageSource, /void this\.auth\.logout\(accountId\)/);
    assert.match(pageSource, /void this\.auth\.login\(\)/);
    assert.match(pageSource, /void this\.auth\.select\(accountId\)/);
    assert.match(pageSource, /'account\.add'/);
    assert.match(pageSource, /account\.select_use/);
    assert.equal(frJson["account.select_use"], "Utiliser ce compte");
    assert.match(pageSource, /\(clicked\)="login\(\)"/);
    assert.match(pageSource, /\(clicked\)="logout\(/);
    assert.match(pageSource, /\(clicked\)="select\(/);
  });

  it("multi-account list scrolls when many accounts", () => {
    assert.match(pageSource, /max-height:\s*14rem/);
    assert.match(pageSource, /overflow-y:\s*auto/);
  });

  it("no mockup member-since / role / Minecraft profile / Discord", () => {
    assert.doesNotMatch(pageSource, /Membre depuis|Joueur actif|Membre de la communauté/i);
    assert.doesNotMatch(pageSource, /profil Minecraft|minecraft\.net|session\.minecraft/i);
    assert.doesNotMatch(pageSource, /Discord|discord\.gg/i);
    assert.equal(
      Object.keys(frJson).filter((k) => /member_since|role\.community|joueur_actif/i.test(k))
        .length,
      0,
    );
  });

  it("no token / private fields in Account template", () => {
    assert.doesNotMatch(
      pageSource,
      /accessToken|refreshToken|xsts|pkce|code_verifier|Bearer |email\b/i,
    );
    assert.match(pageSource, /minecraftUsername/);
    assert.match(pageSource, /accountId/);
    assert.match(pageSource, /lastUsedAtMs/);
  });

  it("no third-party skin APIs; initials fallback", () => {
    assert.match(pageSource, /avatarInitials/);
    assert.doesNotMatch(pageSource, /crafatar|minotar|mc-heads|visage\.surge/i);
  });

  it("Microsoft card does not invent SweetCraft entitlement row", () => {
    assert.doesNotMatch(pageSource, /Accès aux services SweetCraft/i);
    assert.match(pageSource, /account\.ms\.row\.session/);
    assert.equal(frJson["account.ms.row.session"], "Session launcher sécurisée");
  });

  it("last-used only via formatLastUsed — no invented Date.now in Account UI", () => {
    const presentation = readFileSync(
      path.join(root, "ui/src/app/features/account/account-presentation.ts"),
      "utf8",
    );
    assert.match(pageSource, /lastUsedLabel\(\)/);
    assert.match(pageSource, /formatLastUsed\(this\.active\(\)\?\.lastUsedAtMs\)/);
    assert.doesNotMatch(pageSource, /Date\.now\s*\(/);
    assert.doesNotMatch(presentation, /Date\.now\s*\(/);
    assert.doesNotMatch(presentation, /new Date\s*\(\s*\)/);
  });

  it("section-nav / ACCOUNT_SECTION_IDS / account.nav.overview removed", () => {
    assert.doesNotMatch(pageSource, /section-nav/);
    assert.doesNotMatch(pageSource, /ACCOUNT_SECTION_IDS/);
    assert.doesNotMatch(pageSource, /accountSectionScrollBehavior/);
    assert.doesNotMatch(pageSource, /account\.nav\.overview/);
    assert.doesNotMatch(pageSource, /activeSection|setSection|sectionValue/);
    assert.match(pageSource, /id="account-saved"/);
    assert.match(pageSource, /scrollToSaved\(\)/);
    assert.doesNotMatch(pageSource, /routerLink|Router\.navigate|createUrlTree/);
    assert.equal(frJson["account.nav.overview"], undefined);
  });

  it("MS learn + security advice open ModalService — no siteUrl href", () => {
    assert.match(pageSource, /ModalService/);
    assert.match(pageSource, /this\.modal\.open\(/);
    assert.match(pageSource, /openMsHelp\(\)/);
    assert.match(pageSource, /openSecurityHelp\(\)/);
    assert.match(pageSource, /account\.ms\.help\.title/);
    assert.match(pageSource, /account\.security\.help\.title/);
    assert.match(modalServiceSource, /export interface ModalConfig/);
    assert.match(modalServiceSource, /sections\?:/);
    // The two help CTAs must be buttons, not anchors to siteUrl.
    assert.match(pageSource, /\(click\)="openMsHelp\(\)"/);
    assert.match(pageSource, /\(click\)="openSecurityHelp\(\)"/);
    assert.doesNotMatch(
      pageSource,
      /\[href\]="siteUrl"[^>]*>[\s\S]*account\.ms\.learn/,
    );
    assert.doesNotMatch(
      pageSource,
      /account\.ms\.learn[\s\S]{0,120}\[href\]="siteUrl"/,
    );
    assert.doesNotMatch(
      pageSource,
      /\[href\]="siteUrl"[^>]*>[\s\S]*account\.security\.advice/,
    );
    assert.equal(frJson["account.ms.help.title"], "Connexion Microsoft & Minecraft");
    assert.equal(frJson["account.security.help.title"], "Sécuriser votre compte");
    assert.ok(frJson["account.security.tip4.title"]);
    assert.ok(frJson["account.security.tip5.title"]);
  });

  it("three cards share card-main + card-foot footer pattern", () => {
    assert.match(pageSource, /class="card-main"/);
    const feet = pageSource.match(/class="card-foot"/g) ?? [];
    assert.equal(feet.length, 3);
    assert.match(pageSource, /account\.ms\.learn/);
    assert.match(pageSource, /account\.security\.advice/);
    assert.match(pageSource, /account\.add/);
  });

  it("Account hero is compacted vs shared Home defaults (page-local override)", () => {
    assert.match(pageSource, /min-height: clamp\(21rem, 38vh, 26rem\)/);
    assert.match(pageSource, /padding-bottom: clamp\(5\.25rem, 13vh, 8rem\)/);
  });

  it("dedicated Account WebP assets (not Home hero)", () => {
    const assetsSource = readFileSync(
      path.join(root, "ui/src/app/features/account/account-assets.ts"),
      "utf8",
    );
    assert.match(assetsSource, /sweetcraft-account-hero\.webp/);
    assert.match(assetsSource, /sweetcraft-account-community\.webp/);
    assert.match(pageSource, /ACCOUNT_ASSETS\.hero/);
    assert.match(pageSource, /ACCOUNT_ASSETS\.community/);
    assert.doesNotMatch(pageSource, /sweetcraft-home-hero\.webp/);
  });

  it("community CTA uses official website URL (not CDN)", () => {
    assert.match(productLinks, /https:\/\/www\.xnosweet\.fr\/sweetcraft/);
    assert.match(pageSource, /SWEETCRAFT_WEBSITE_URL/);
    assert.match(pageSource, /account\.community\.site/);
    assert.doesNotMatch(pageSource, /cdn\.xnosweet\.fr/);
    const httpsUrls = [...pageSource.matchAll(/https:\/\/[^\s'"]+/g)].map((m) => m[0]!);
    for (const url of httpsUrls) {
      assert.equal(url.startsWith("https://www.xnosweet.fr/sweetcraft"), true, url);
    }
  });

  it("Home community CTAs use the same website URL constant", () => {
    assert.match(homeSource, /SWEETCRAFT_WEBSITE_URL/);
    assert.match(homeSource, /home\.community\.site/);
    assert.doesNotMatch(homeSource, /const SITE_URL = 'https:\/\/sweetcraft\.datho\.st/);
  });

  it("no Préférences nav / no section tabs", () => {
    assert.doesNotMatch(pageSource, /#account-overview/);
    assert.doesNotMatch(pageSource, /Préférences|preferences|routerLink.*pref/i);
  });

  it("responsive + reduced-motion breakpoints present", () => {
    assert.match(pageSource, /@media \(max-width: 1279px\)/);
    assert.match(pageSource, /@media \(max-width: 900px\)/);
    assert.match(pageSource, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(pageSource, /repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(pageSource, /repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(pageSource, /:focus-visible/);
  });

  it("accessibility markers present", () => {
    assert.match(pageSource, /aria-live="polite"/);
    assert.match(pageSource, /<h1 class="hero-title"/);
    assert.match(pageSource, /aria-hidden="true"/);
    assert.match(pageSource, /role="alert"/);
  });

  it("Home page source untouched by Account polish markers", () => {
    assert.doesNotMatch(homeSource, /account-overview|sweetcraft-account-hero/);
    assert.match(homeSource, /sweetcraft-home-hero|HOME_ASSETS|home\.hero/);
  });
});
