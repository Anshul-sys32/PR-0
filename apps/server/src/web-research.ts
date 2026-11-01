import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

export interface ResolvedHostAddress { address: string; family: 4 | 6 }
export type HostResolver = (hostname: string) => Promise<ResolvedHostAddress[]>;
export interface PublicPageResponse { url: string; contentType: string; body: string }

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;

const blockedIpv4 = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blockedIpv4.addSubnet(subnet, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [subnet, prefix] of [["2001::", 23], ["2001:2::", 48], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blockedIpv6.addSubnet(subnet, prefix, "ipv6");
}

export function isPublicAddress(address: string, family = isIP(address)): boolean {
  if (isIP(address) !== family) return false;
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  return family === 6 && globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
}

export function parsePublicResearchUrl(value: string): URL {
  if (value.length > MAX_URL_LENGTH) throw new Error("URL exceeds the 2048 character limit");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid public HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Research accepts HTTPS URLs on the default port without embedded credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (isIP(hostname) || !hostname.includes(".") || /\.(?:localhost|local|internal|test|example|invalid|onion)$/.test(hostname)) {
    throw new Error("Research requires a public DNS hostname, not a local or IP-literal address");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

const resolveHost: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap(({ address, family }) => family === 4 || family === 6 ? [{ address, family }] : []);
};

export async function resolvePublicAddress(hostname: string, resolver: HostResolver = resolveHost): Promise<ResolvedHostAddress> {
  let addresses: ResolvedHostAddress[];
  try { addresses = await resolver(hostname); } catch { throw new Error("Public hostname resolution failed"); }
  if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw new Error("Hostname resolves to a non-public or unsupported network address");
  }
  const pinned = addresses[0];
  if (!pinned) throw new Error("Public hostname resolution failed");
  return pinned;
}

function requestPublicPage(url: URL, pinned: ResolvedHostAddress): Promise<Pick<PublicPageResponse, "contentType" | "body">> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, page?: Pick<PublicPageResponse, "contentType" | "body">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (page) resolve(page);
      else reject(new Error("Public page response was empty"));
    };
    const lookupPinned = ((hostname, options, callback) => {
      if (hostname.toLowerCase() !== url.hostname.toLowerCase()) {
        callback(new Error("Unexpected hostname lookup"), "", 0);
        return;
      }
      if (typeof options === "object" && options !== null && options.all) {
        callback(null, [pinned]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    }) as NonNullable<RequestOptions["lookup"]>;
    const client = httpsRequest({
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      lookup: lookupPinned,
      headers: {
        accept: "text/html, text/plain;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "Project-PR-0-Public-Research/1.0"
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        finish(new Error("Redirects are not followed; submit the destination URL directly"));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        finish(new Error(`Public page returned HTTP ${status}`));
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (contentType !== "text/html" && contentType !== "text/plain") {
        response.resume();
        finish(new Error("Only text/html and text/plain pages are supported"));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        response.resume();
        finish(new Error("Public page exceeds the 1 MB response limit"));
        return;
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          client.destroy(new Error("Public page exceeds the 1 MB response limit"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => finish(undefined, { contentType, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => finish(new Error("Public page response failed")));
    });
    const timeout = setTimeout(() => client.destroy(new Error("Public page request timed out")), REQUEST_TIMEOUT_MS);
    client.on("error", (error) => finish(error.message.includes("1 MB") ? error : new Error("Public page request failed or timed out")));
    client.end();
  });
}

export async function researchPublicPage(value: string, resolver: HostResolver = resolveHost): Promise<PublicPageResponse> {
  const url = parsePublicResearchUrl(value);
  const pinned = await resolvePublicAddress(url.hostname, resolver);
  const response = await requestPublicPage(url, pinned);
  return { url: url.href, ...response };
}