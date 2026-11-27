import { test, expect } from '@playwright/test';

const SHORT_LINK = (baseURL) => new RegExp(`^${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/[A-Za-z0-9]{8}$`);

async function shorten(page, url) {
  await page.getByLabel('Destination URL').fill(url);
  await page.getByRole('button', { name: 'Shorten' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('page loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(err.message));
  await page.reload();

  await expect(page.getByRole('heading', { name: 'URL Shortener' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'API docs' })).toHaveAttribute('href', '/docs');
  expect(errors).toEqual([]);
});

test('declares an inline favicon so browsers do not request /favicon.ico', async ({ page }) => {
  // Headless Chromium skips the favicon request, so check the declaration directly.
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml,/);
});

test('creates a short link and copies it to the clipboard', async ({ page, baseURL }) => {
  // On plain HTTP (for example an Ingress host) the app copies with execCommand,
  // which the Clipboard API cannot read back, so record what that path copies.
  await page.addInitScript(() => {
    const execCommand = document.execCommand.bind(document);
    document.execCommand = (command, ...args) => {
      if (command === 'copy') window.copiedText = document.activeElement?.value;
      return execCommand(command, ...args);
    };
  });
  await page.reload();
  await shorten(page, 'https://example.com/guide');

  const link = page.locator('.result a');
  await expect(link).toHaveText(SHORT_LINK(baseURL));

  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard.');
  const copied = await page.evaluate(() =>
    window.isSecureContext ? navigator.clipboard.readText() : window.copiedText);
  expect(copied).toBe(await link.textContent());
});

test('short link redirects to the destination with query and fragment', async ({ page, baseURL }) => {
  // Point the link back at the app itself so the test does not depend on the internet.
  // (page.route cannot intercept the target of a redirect.)
  const destination = `${baseURL}/docs?tab=readme#run-locally`;
  await shorten(page, destination);

  await page.locator('.result a').click();
  await expect(page).toHaveURL(destination);
  await expect(page).toHaveTitle(/URL Shortener/);
});

for (const [name, url] of [
  ['unsupported scheme', 'ftp://example.com/file.txt'],
  ['embedded credentials', 'https://admin:secret@example.com/'],
]) {
  test(`shows an error for ${name}`, async ({ page }) => {
    await shorten(page, url);
    await expect(page.getByRole('alert')).toHaveText('Enter a valid HTTP or HTTPS URL without credentials.');
    await expect(page.locator('.result')).toHaveCount(0);
  });
}

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test('result fits the screen and the Copy button stays on one line', async ({ page }) => {
    await shorten(page, 'https://example.com/a/really/long/path/that/should/wrap/on/small/screens?with=query');
    const copy = page.getByRole('button', { name: 'Copy' });
    await expect(copy).toBeVisible();

    const { height } = await copy.boundingBox();
    expect(height).toBeLessThan(56); // min-height is 48px; a wrapped label is about 64px
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
