/** Génère les icônes PNG de la PWA à partir de public/icon.svg (via le Chromium de Playwright). */
import fs from "node:fs";
import { chromium } from "playwright";

async function main() {
  const svg = fs.readFileSync("public/icon.svg", "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const targets: [string, number, boolean][] = [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true], ["apple-touch-icon.png", 180, false]];
  for (const [name, size, maskable] of targets) {
    await page.setViewportSize({ width: size, height: size });
    const inner = maskable ? svg.replace('rx="112"', 'rx="0"') : svg;
    await page.setContent(`<html><body style="margin:0;background:${maskable ? "#0b0b0b" : "transparent"}"><div style="width:${size}px;height:${size}px;${maskable ? "padding:10%;box-sizing:border-box" : ""}">${inner.replace("<svg ", `<svg width="100%" height="100%" `)}</div></body></html>`);
    await page.screenshot({ path: `public/icons/${name}`, omitBackground: !maskable });
  }
  await browser.close();
  console.log("Icônes générées dans public/icons/");
}
main();
