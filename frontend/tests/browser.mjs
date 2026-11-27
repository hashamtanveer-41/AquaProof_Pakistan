import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requirePlaywright = createRequire(
  resolve(process.env.AQUAPROOF_PLAYWRIGHT_DIR ?? "../.qa/browser", "package.json"),
);
const { chromium } = requirePlaywright("playwright");
const base = process.env.AQUAPROOF_BROWSER_URL ?? "http://127.0.0.1:5173";
const officer = process.env.AQUAPROOF_TEST_OFFICER_PASSWORD;
if (!officer) throw new Error("Set AQUAPROOF_TEST_OFFICER_PASSWORD for the isolated QA instance.");
const runPersistence = process.env.AQUAPROOF_BROWSER_PERSISTENCE === "1";
const browser = await chromium.launch({
  channel: process.env.AQUAPROOF_BROWSER_CHANNEL ?? "msedge",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 920 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function login() {
  await page.getByLabel("Officer password").fill(officer);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Officer password").waitFor({ state: "hidden" });
}

try {
  const visit = await page.goto(base, { waitUntil: "domcontentloaded" });
  assert.equal(visit.status(), 200);
  await page.getByRole("heading", { name: "Farm Map", exact: true }).waitFor();
  assert.equal(await page.request.get(base + "/api/registry").then((r) => r.status()), 401);
  await login();
  if (!runPersistence) {
    await page.getByText("The registry database is unavailable.", { exact: false }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Register Farmer", exact: true }).isDisabled(),
      true,
    );
  }
  const search = page.getByRole("textbox", {
    name: "Search places, registered fields or coordinates",
  });
  await search.fill("30.1575, 71.5249");
  await search.press("Enter");
  await page.getByText("30.1575, 71.5249", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Expand map" }).click();
  await page.getByRole("button", { name: "Exit expanded map" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Expand map" }).waitFor();

  if (runPersistence) {
    const mapConfig = await page.request
      .get(base + "/api/map/config")
      .then((response) => response.json());
    const basemap = page.getByRole("combobox", { name: "Basemap", exact: true });
    const street = mapConfig.browser_token || mapConfig.server_basemaps ? "open" : "street";
    await basemap.locator(`option[value="${street}"]`).waitFor({ state: "attached" });
    assert.equal(await basemap.inputValue(), street);
    await page.getByRole("button", { name: "Draw Boundary", exact: true }).click();
    assert.equal(await basemap.inputValue(), street);
    assert.equal(await basemap.isDisabled(), true);
    await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
    const canvas = await page.locator(".maplibregl-canvas").boundingBox();
    assert.ok(canvas);
    const baseX = canvas.x + canvas.width * 0.42;
    const baseY = canvas.y + canvas.height * 0.42;
    await page.mouse.move(baseX, baseY);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(500);
    await page.mouse.click(baseX, baseY);
    await page.mouse.click(baseX + 55, baseY);
    await page.mouse.click(baseX + 45, baseY + 52);
    await page.mouse.click(baseX, baseY);
    await page.getByText("ESTIMATED AREA", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.getByText("ESTIMATED AREA", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Discard changes" }).click();
    assert.equal(await basemap.inputValue(), street);
    const unique = Date.now().toString();
    const name = "QA farm boundary " + unique;
    const geo = {
      type: "Polygon",
      coordinates: [
        [
          [71.52, 30.15],
          [71.523, 30.15],
          [71.5215, 30.152],
          [71.52, 30.15],
        ],
      ],
    };
    await page.getByRole("button", { name: "Import boundary" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({
      name: "parcel.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify(geo)),
    });
    await page.getByRole("button", { name: "Save Farm" }).click({ timeout: 30_000 });
    const modal = page.getByRole("dialog", { name: "Save farm boundary" });
    await modal.getByLabel("Farmer name").fill("QA Farmer " + unique);
    await modal.getByLabel("WhatsApp phone").fill("030" + unique.slice(-8));
    await modal.getByLabel("Province or region").fill("Punjab");
    await modal.getByLabel("Village").fill("QA village");
    await modal.getByLabel("Field name").fill(name);
    await modal.locator('select[name="crop"]').selectOption({ label: "Wheat" });
    await modal.locator('select[name="soil"]').selectOption({ label: "Loam" });
    await modal.locator('select[name="source"]').selectOption({ label: "Rain-fed" });
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith("/api/registrations") && r.request().method() === "POST",
    );
    await modal
      .getByRole("button", { name: /save|register/i })
      .last()
      .click();
    const response = await submitted;
    assert.equal(response.status(), 201);
    const saved = await response.json();
    assert.equal(saved.field.name, name);
    await page.getByRole("heading", { name: "QA Farmer " + unique, exact: true }).waitFor();
    await page.getByRole("button", { name: "Farm Map", exact: true }).click();
    for (const format of ["GeoJSON", "KML"]) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: format, exact: true }).click(),
      ]);
      assert.match(download.suggestedFilename(), new RegExp(`\\.${format.toLowerCase()}$`));
    }
    await page.reload();
    assert.equal(await page.request.get(base + "/api/registry").then((r) => r.status()), 200);
    await page.getByRole("button", { name: "Edit Boundary" }).waitFor();
    await search.fill(name);
    await search.press("Enter");
    await page.getByRole("button", { name: "Edit Boundary" }).click();
    assert.equal(await basemap.inputValue(), street);
    await page.getByRole("heading", { name }).waitFor();
    await page.getByText("ESTIMATED AREA", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Discard changes" }).click();
    const assistant = await page.request
      .get(base + "/api/assistant/status")
      .then((response) => response.json());
    if (assistant.enabled && assistant.whatsapp_configured && !assistant.whatsapp_worker_enabled) {
      await page.getByRole("button", { name: "AI Advisory Center", exact: true }).click();
      await page.getByLabel("Registered field").selectOption({ label: name });
      await page.getByText("The WhatsApp worker is paused.", { exact: false }).waitFor();
      assert.equal(await page.getByLabel("Farmer's preferred language").inputValue(), "ur");
      await page.getByRole("button", { name: "Send WhatsApp verification", exact: true }).click();
      await page.getByText("WhatsApp verification queued.", { exact: true }).waitFor();
      await page.getByText("Awaiting WhatsApp verification", { exact: true }).waitFor();
      await page.getByRole("button", { name: "WhatsApp Conversations", exact: true }).click();
      await page.getByRole("heading", { name: "WhatsApp Conversations", exact: true }).waitFor();
      await page.getByLabel("Farmer", { exact: true }).selectOption(saved.farmer.id);
      await page.getByText("Farmer verification pending", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Refresh conversation", exact: true }).click();
      await page.getByText("Refreshed saved conversation.", { exact: true }).waitFor();
      await page.locator(".whatsapp-message.outbound").waitFor();
      assert.equal(await page.locator(".whatsapp-message time").count(), 0);
      assert.equal(await page.locator(".whatsapp-message .chip").count(), 0);
      await page.getByRole("button", { name: "Open Advisory Center", exact: true }).click();
      await page.getByText("Awaiting WhatsApp verification", { exact: true }).waitFor();
    }
    assert.equal(
      await page.request.delete(base + "/api/fields/" + saved.field.id).then((r) => r.status()),
      200,
    );
    await page.getByRole("button", { name: "Reports & History", exact: true }).click();
    const archivedField = page.getByRole("listitem").filter({ hasText: name });
    await archivedField.getByRole("button", { name: "Delete permanently", exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.dismiss());
    await archivedField.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await archivedField.waitFor();
    page.once("dialog", (dialog) => dialog.accept("DELETE"));
    await archivedField.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await archivedField.waitFor({ state: "hidden" });
    let sendingState = "WORKING";
    let unlinkConfirmed = false;
    await page.route("**/api/assistant/waha/*", async (route) => {
      const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
      if (endpoint === "session") {
        await route.fulfill({
          json: {
            configured: true,
            state: sendingState,
            phone: sendingState === "WORKING" ? "923000000001" : null,
          },
        });
      } else if (endpoint === "unlink") {
        unlinkConfirmed = route.request().postDataJSON().confirmation === "UNLINK";
        sendingState = "STOPPED";
        await route.fulfill({ status: 204 });
      } else if (endpoint === "pair") {
        sendingState = "SCAN_QR_CODE";
        await route.fulfill({ status: 204 });
      } else {
        await route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            "base64",
          ),
        });
      }
    });
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("heading", { name: "External service status" }).waitFor();
    await page.getByText("Linked sending phone +923000000001", { exact: true }).waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Unlink sending phone", exact: true }).click();
    await page.getByRole("button", { name: "Link sending phone", exact: true }).click();
    await page.getByRole("img", { name: "WhatsApp pairing QR code" }).waitFor();
    assert.equal(unlinkConfirmed, true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", { name: runPersistence ? "Settings" : "Farm Map", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  if (runPersistence) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.getByRole("button", { name: "Farm Map", exact: true }).click();
    await page.getByRole("heading", { name: "Farm Map", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    `Edge passed desktop and mobile workflows${runPersistence ? ", registration, boundary persistence, exports and administration" : ", officer authentication and database outage handling"}.`,
  );
} finally {
  await browser.close();
}
