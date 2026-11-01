import { describe, expect, it } from "vitest";
import { isPublicAddress, parsePublicResearchUrl, resolvePublicAddress } from "../../apps/server/src/web-research.js";

describe("public web research network policy", () => {
  it("accepts HTTPS public DNS URLs and strips fragments", () => {
    expect(parsePublicResearchUrl("https://example.org/article#section").href).toBe("https://example.org/article");
  });

  it.each([
    "http://example.org/page",
    "https://user:pass@example.org/page",
    "https://127.0.0.1/admin",
    "https://[::1]/admin",
    "https://localhost/",
    "https://service.internal/",
    "https://example.org:8443/"
  ])("rejects unsafe URL %s", (url) => {
    expect(() => parsePublicResearchUrl(url)).toThrow();
  });

  it("rejects an address whose DNS family does not match its parsed address", () => {
    expect(isPublicAddress("127.0.0.1", 6)).toBe(false);
    expect(isPublicAddress("2606:4700:4700::1111", 4)).toBe(false);
  });

  it.each([
    ["93.184.216.34", 4, true],
    ["10.0.0.4", 4, false],
    ["100.64.0.1", 4, false],
    ["169.254.169.254", 4, false],
    ["192.0.2.10", 4, false],
    ["224.0.0.1", 4, false],
    ["2606:4700:4700::1111", 6, true],
    ["fc00::1", 6, false],
    ["fe80::1", 6, false],
    ["2001:db8::1", 6, false],
    ["::ffff:127.0.0.1", 6, false]
  ] as const)("classifies %s as public=%s", (address, family, expected) => {
    expect(isPublicAddress(address, family)).toBe(expected);
  });

  it("rejects a hostname if any DNS answer is non-public", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.2", family: 4 as const }
    ];
    await expect(resolvePublicAddress("example.org", resolver)).rejects.toThrow("non-public");
  });

  it("pins the selected public address after validating every answer", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const }
    ];
    await expect(resolvePublicAddress("example.org", resolver)).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });
});