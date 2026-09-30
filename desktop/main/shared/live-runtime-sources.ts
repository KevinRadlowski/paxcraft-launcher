/**
 * Shared live Mojang/Fabric metadata sources for desktop adapters.
 * Reuses frozen URL constants + FetchHttpClient — no ad-hoc parsers.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

export type LiveRuntimeSources = {
  fetchVersionManifest(): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
  fetchVersionMeta(url: string): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
  fetchAssetIndex(url: string): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
  fetchFabricLoaderList(mc: string): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
  fetchFabricProfile(
    mc: string,
    loader: string
  ): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
  fetchUrlBytes(url: string): Promise<{ bytes: Uint8Array; url: string; contentType?: string }>;
};

type HttpClient = {
  request(opts: { url: string; maxBytes: number }): Promise<{
    body: Buffer | Uint8Array;
    finalUrl: string;
    headers: Record<string, string | undefined>;
  }>;
};

/**
 * Build RuntimeMetadataSources using frozen Mojang/Fabric endpoints from dist.
 */
export async function createLiveRuntimeSources(
  distRoot: string,
  http: HttpClient
): Promise<LiveRuntimeSources> {
  const metaHref = pathToFileURL(path.join(distRoot, "minecraft", "metadata", "types.js")).href;
  const bytesHref = pathToFileURL(path.join(distRoot, "minecraft", "metadata", "bytes.js")).href;
  const [meta, bytes] = await Promise.all([import(metaHref), import(bytesHref)]);
  const versionManifestUrl = meta.DEFAULT_VERSION_MANIFEST_URL as string;
  const fabricBase = meta.DEFAULT_FABRIC_META_BASE as string;
  const maxBytes = bytes.DEFAULT_MINECRAFT_JSON_MAX_BYTES as number;

  const getBytes = async (url: string) => {
    const res = await http.request({ url, maxBytes });
    const out: { bytes: Uint8Array; url: string; contentType?: string } = {
      bytes: new Uint8Array(res.body),
      url: res.finalUrl
    };
    if (res.headers["content-type"]) out.contentType = res.headers["content-type"];
    return out;
  };

  return {
    fetchVersionManifest: () => getBytes(versionManifestUrl),
    fetchVersionMeta: (url) => getBytes(url),
    fetchAssetIndex: (url) => getBytes(url),
    fetchFabricLoaderList: (mc) =>
      getBytes(`${fabricBase}/v2/versions/loader/${encodeURIComponent(mc)}`),
    fetchFabricProfile: (mc, loader) =>
      getBytes(
        `${fabricBase}/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`
      ),
    fetchUrlBytes: (url) => getBytes(url)
  };
}

export async function loadDefaultProductBase(distRoot: string): Promise<string> {
  const href = pathToFileURL(path.join(distRoot, "distribution", "urls", "index.js")).href;
  const mod = await import(href);
  return mod.DEFAULT_PRODUCT_BASE as string;
}
