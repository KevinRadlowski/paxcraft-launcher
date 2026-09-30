import {
  parseChannelBytes,
  verifyChannelSignature,
  type ReleaseChannelName,
  type VerifiedChannel
} from "../channel/index.js";
import { ErrorCode, LauncherError } from "../errors/index.js";
import { parseClientManifestBytes, assertManifestBytesHash, type ClientManifest } from "../manifest/index.js";
import {
  assertChannelReleaseConsistency,
  assertReleaseBytesHash,
  parseReleaseBytes,
  verifyReleaseSignature,
  type VerifiedRelease
} from "../release/index.js";
import type { MapTrustedKeyStore } from "../trust/index.js";
import type { HttpClient } from "../../distribution/http/index.js";
import {
  channelUrl,
  clientManifestUrl,
  joinProductUrl,
  normalizeProductBase
} from "../../distribution/urls/index.js";
import {
  checkAntiRollback,
  type AntiRollbackState,
  type CandidateReleaseIdentity
} from "../../instance/state/index.js";

/**
 * Fully verified resolution result. Must never be constructed before every step succeeds.
 */
export interface TrustedResolvedRelease {
  readonly trusted: true;
  readonly channel: VerifiedChannel;
  readonly release: VerifiedRelease;
  readonly clientManifest: ClientManifest;
  readonly productBase: string;
  readonly candidate: CandidateReleaseIdentity;
}

export interface ResolveLatestReleaseOptions {
  channel: ReleaseChannelName;
  productBase: string;
  http: HttpClient;
  trust: MapTrustedKeyStore;
  antiRollbackState: AntiRollbackState;
  signal?: AbortSignal;
}

/**
 * FETCH CHANNEL → PARSE → VERIFY SIG → ANTI-ROLLBACK
 * → FETCH RELEASE → SHA256 → PARSE → VERIFY SIG → CONSISTENCY
 * → FETCH CLIENT MANIFEST → HASH → PARSE → VALIDATE
 * → TrustedResolvedRelease
 *
 * unsigned-dev never yields TrustedResolvedRelease (fail closed).
 */
export async function resolveLatestRelease(opts: ResolveLatestReleaseOptions): Promise<TrustedResolvedRelease> {
  const productBase = normalizeProductBase(opts.productBase);

  const httpOpts = opts.signal ? { signal: opts.signal } : {};

  // 1. Channel
  const channelRes = await opts.http.request({
    url: channelUrl(productBase, opts.channel),
    ...httpOpts
  });
  const channelDesc = parseChannelBytes(channelRes.body);
  if (channelDesc.channel !== opts.channel) {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "channel field mismatch with requested channel", {
      requested: opts.channel,
      got: channelDesc.channel
    });
  }
  const verifiedChannel = verifyChannelSignature(channelDesc, opts.trust);

  // 2. Anti-rollback (before fetching release bytes — refuse early on sequence)
  const candidate: CandidateReleaseIdentity = {
    channel: channelDesc.channel,
    releaseSequence: channelDesc.releaseSequence,
    packVersion: channelDesc.packVersion,
    releasePath: channelDesc.releasePath,
    releaseSha256: channelDesc.releaseSha256
  };
  checkAntiRollback(opts.antiRollbackState, candidate);

  // 3. Release
  const releaseUrl = joinProductUrl(productBase, channelDesc.releasePath);
  const releaseRes = await opts.http.request({
    url: releaseUrl,
    ...httpOpts
  });
  const releaseSha256 = assertReleaseBytesHash(releaseRes.body, channelDesc.releaseSha256);
  const releaseDoc = parseReleaseBytes(releaseRes.body);
  const { publicKeyId } = verifyReleaseSignature(releaseDoc, opts.trust);
  assertChannelReleaseConsistency(verifiedChannel, releaseDoc, releaseSha256);

  const verifiedRelease: VerifiedRelease = {
    trusted: true,
    release: releaseDoc,
    releaseBytesSha256: releaseSha256,
    publicKeyId
  };

  // 4. Client manifest
  const expectedManifestUrl = clientManifestUrl(productBase, releaseDoc.packVersion);
  const manifestUrl = `${joinProductUrl(productBase, `releases/${releaseDoc.packVersion}`)}/${releaseDoc.artefacts.clientManifest.path}`;
  if (manifestUrl !== expectedManifestUrl) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "client manifest URL mismatch", {
      expectedManifestUrl,
      manifestUrl
    });
  }
  const manifestRes = await opts.http.request({
    url: manifestUrl,
    ...httpOpts
  });
  assertManifestBytesHash(manifestRes.body, releaseDoc.artefacts.clientManifest.sha256);
  const clientManifest = parseClientManifestBytes(manifestRes.body);
  if (clientManifest.packVersion !== releaseDoc.packVersion) {
    throw new LauncherError(ErrorCode.CHANNEL_RELEASE_MISMATCH, "manifest packVersion mismatch", {
      release: releaseDoc.packVersion,
      manifest: clientManifest.packVersion
    });
  }
  if (clientManifest.minecraft !== releaseDoc.minecraft || clientManifest.fabricLoader !== releaseDoc.fabricLoader) {
    throw new LauncherError(ErrorCode.CHANNEL_RELEASE_MISMATCH, "manifest minecraft/fabricLoader mismatch");
  }

  return {
    trusted: true,
    channel: verifiedChannel,
    release: verifiedRelease,
    clientManifest,
    productBase,
    candidate
  };
}
