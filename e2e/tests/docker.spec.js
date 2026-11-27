import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

// These tests stop and recreate Compose containers. Run them with `npm run test:docker`
// against the local stack only.
test.skip(!process.env.E2E_DOCKER, 'Set E2E_DOCKER=1 to run tests that control Docker Compose');
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const compose = (args) => execSync(`docker compose ${args}`, { cwd: repoRoot, stdio: 'pipe' });

async function waitForHealthy(request) {
  await expect
    .poll(async () => (await request.get('/health').catch(() => null))?.status(), { timeout: 60_000 })
    .toBe(200);
}

test('links survive recreating both containers', async ({ request }) => {
  const destination = 'https://example.com/persisted';
  const { code } = await (await request.post('/api/links', { data: { url: destination } })).json();

  compose('up --detach --force-recreate --wait');
  await waitForHealthy(request);

  const res = await request.get(`/s/${code}`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toBe(destination);
});

test('returns 503 while the database is down and recovers afterwards', async ({ request }) => {
  const { code } = await (await request.post('/api/links', { data: { url: 'https://example.com/' } })).json();
  compose('stop db');
  try {
    const health = await request.get('/health');
    expect(health.status()).toBe(503);

    const created = await request.post('/api/links', { data: { url: 'https://example.com/down' } });
    expect(created.status()).toBe(503);
    expect(await created.json()).toEqual({ detail: 'Database unavailable' });

    const followed = await request.get(`/s/${code}`, { maxRedirects: 0 });
    expect(followed.status()).toBe(503);
  } finally {
    compose('start db');
  }
  await waitForHealthy(request);
  expect((await request.get(`/s/${code}`, { maxRedirects: 0 })).status()).toBe(307);
});
