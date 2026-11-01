import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { automatePublicPage } from "../../apps/server/src/browser-automation.js";

const browserAvailable = existsSync(chromium.executablePath());

describe.skipIf(!browserAvailable)("isolated public browser automation", () => {
  it("routes navigations through the fetcher and blocks page scripts and subresources", async () => {
    const fetchedUrls: string[] = [];
    const fetchPage = async (url: string) => {
      fetchedUrls.push(url);
      if (url === "https://example.org/") return {
        url,
        contentType: "text/html",
        body: '<!doctype html><title>Start</title><input id="query" type="text"><a id="next" href="https://example.org/next">Next</a><a id="unsafe" href="file:///etc/passwd">Unsafe</a><img src="https://tracker.example/pixel"><script>document.title="script-ran"</script>'
      };
      if (url === "https://example.org/next") return {
        url,
        contentType: "text/html",
        body: '<!doctype html><title>Finish</title><p>Page reached</p><script>document.body.innerText="script-ran"</script>'
      };
      throw new Error("Unexpected URL requested");
    };
    const result = await automatePublicPage({
      url: "https://example.org/",
      actions: [
        { type: "fill", selector: "#query", value: "local search" },
        { type: "click", selector: "#next" }
      ]
    }, fetchPage);
    expect(fetchedUrls).toEqual(["https://example.org/", "https://example.org/next"]);
    expect(result).toMatchObject({ url: "https://example.org/next", title: "Finish", text: "Page reached" });
    expect(result.actions).toEqual([
      { type: "fill", selector: "#query", ok: true, message: "Text field filled locally; no form was submitted" },
      { type: "click", selector: "#next", ok: true, message: "Clicked in the isolated page" }
    ]);
    expect(result.screenshotBase64.length).toBeGreaterThan(100);
  });

  it("rejects local and non-HTTPS link targets without fetching them", async () => {
    const fetchedUrls: string[] = [];
    const fetchPage = async (url: string) => {
      fetchedUrls.push(url);
      return { url, contentType: "text/html", body: '<!doctype html><title>Safe</title><a id="unsafe" href="file:///etc/passwd">Unsafe</a>' };
    };
    const result = await automatePublicPage({ url: "https://example.org/", actions: [{ type: "click", selector: "#unsafe" }] }, fetchPage);
    expect(result.actions[0]).toMatchObject({ ok: false, message: "Only public HTTPS links can be followed" });
    expect(fetchedUrls).toEqual(["https://example.org/"]);
  });
});