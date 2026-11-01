import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserAutomationRequest } from "@pr-0/shared";
import { parsePublicResearchUrl, researchPublicPage, type PublicPageResponse } from "./web-research.js";

export interface BrowserActionResult { type: "click" | "fill"; selector: string; ok: boolean; message: string }
export interface BrowserAutomationResult { url: string; title: string; text: string; links: string[]; screenshotBase64: string; actions: BrowserActionResult[] }
export type PublicPageFetcher = (url: string) => Promise<PublicPageResponse>;

const MAX_NAVIGATIONS = 6;
const MAX_ACTIVE_BROWSERS = 2;
const MAX_TEXT_LENGTH = 30_000;
const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
let activeBrowsers = 0;

async function removeInteractiveNetworkElements(page: Page): Promise<void> {
  await page.locator("base,form,iframe,object,embed,input[type=password],input[type=hidden]").evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await page.locator("a[target]").evaluateAll((elements) => elements.forEach((element) => element.removeAttribute("target")));
}

export async function automatePublicPage(input: BrowserAutomationRequest, fetchPage: PublicPageFetcher = researchPublicPage): Promise<BrowserAutomationResult> {
  const initialUrl = parsePublicResearchUrl(input.url).href;
  if (activeBrowsers >= MAX_ACTIVE_BROWSERS) throw new Error("Browser automation is at capacity; retry shortly");
  activeBrowsers++;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      acceptDownloads: false,
      javaScriptEnabled: false,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 800 }
    });
    let navigationCount = 0;
    let navigationError: Error | undefined;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest() || request.method() !== "GET") {
        await route.abort("blockedbyclient");
        return;
      }
      navigationCount++;
      if (navigationCount > MAX_NAVIGATIONS) {
        navigationError = new Error(`Browser navigation limit of ${MAX_NAVIGATIONS} reached`);
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const page = await fetchPage(request.url());
        await route.fulfill({
          status: 200,
          contentType: page.contentType,
          body: page.body,
          headers: { "content-security-policy": CONTENT_SECURITY_POLICY, "x-content-type-options": "nosniff" }
        });
      } catch (error) {
        navigationError = error instanceof Error ? error : new Error("Public page navigation was blocked");
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(2_000);
    page.setDefaultNavigationTimeout(8_000);
    page.on("download", (download) => { void download.cancel().catch(() => undefined); });
    context.on("page", (openedPage) => { if (openedPage !== page) void openedPage.close(); });
    try { await page.goto(initialUrl, { waitUntil: "domcontentloaded" }); }
    catch (error) { throw navigationError ?? (error instanceof Error ? error : new Error("Browser navigation failed")); }
    await removeInteractiveNetworkElements(page);

    const actions: BrowserActionResult[] = [];
    for (const action of input.actions) {
      try {
        const locator = page.locator(action.selector).first();
        if (!(await locator.count())) {
          actions.push({ type: action.type, selector: action.selector, ok: false, message: "No matching element" });
          continue;
        }
        if (action.type === "fill") {
          const target = await locator.evaluate((element) => ({
            tag: element.tagName.toLowerCase(),
            type: element instanceof HTMLInputElement ? element.type.toLowerCase() : "",
            disabled: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.disabled : true,
            readOnly: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.readOnly : true,
            insideForm: Boolean(element.closest("form"))
          }));
          if (!((target.tag === "textarea" || (target.tag === "input" && ["text", "search", "url"].includes(target.type))) && !target.disabled && !target.readOnly && !target.insideForm)) {
            actions.push({ type: action.type, selector: action.selector, ok: false, message: "Only enabled, non-sensitive text fields outside forms can be filled" });
            continue;
          }
          await locator.fill(action.value);
          actions.push({ type: action.type, selector: action.selector, ok: true, message: "Text field filled locally; no form was submitted" });
          continue;
        }
        const target = await locator.evaluate((element) => ({ tag: element.tagName.toLowerCase(), type: element instanceof HTMLButtonElement ? element.type.toLowerCase() : "" }));
        if (!(target.tag === "a" || target.tag === "summary" || (target.tag === "button" && target.type !== "submit"))) {
          actions.push({ type: action.type, selector: action.selector, ok: false, message: "Only links, details summaries, and non-submit buttons can be clicked" });
          continue;
        }
        const previousUrl = page.url();
        let expectedUrl: string | undefined;
        if (target.tag === "a") {
          const href = await locator.evaluate((element) => (element as HTMLAnchorElement).href);
          try {
            const fragment = new URL(href).hash;
            expectedUrl = parsePublicResearchUrl(href).href + fragment;
          } catch {
            actions.push({ type: action.type, selector: action.selector, ok: false, message: "Only public HTTPS links can be followed" });
            continue;
          }
        }
        const navigation = expectedUrl && expectedUrl !== previousUrl
          ? page.waitForURL(expectedUrl, { waitUntil: "domcontentloaded", timeout: 3_000 }).catch(() => undefined)
          : undefined;
        await locator.click({ noWaitAfter: true });
        await navigation;
        if (expectedUrl && page.url() !== expectedUrl) {
          const message = navigationError?.message ?? "Navigation was blocked";
          navigationError = undefined;
          actions.push({ type: action.type, selector: action.selector, ok: false, message });
          continue;
        }
        if (page.url() !== previousUrl) await removeInteractiveNetworkElements(page);
        actions.push({ type: action.type, selector: action.selector, ok: true, message: "Clicked in the isolated page" });
      } catch (error) {
        actions.push({ type: action.type, selector: action.selector, ok: false, message: error instanceof Error ? error.message.slice(0, 200) : "Browser action failed" });
      }
    }

    const [title, text, links, screenshot] = await Promise.all([
      page.title(),
      page.locator("body").innerText().catch(() => ""),
      page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter((href) => href.startsWith("https://")).slice(0, 30)),
      page.screenshot({ type: "png", fullPage: false })
    ]);
    return { url: page.url(), title, text: text.slice(0, MAX_TEXT_LENGTH), links, screenshotBase64: screenshot.toString("base64"), actions };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    activeBrowsers--;
  }
}