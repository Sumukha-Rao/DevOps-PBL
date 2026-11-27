import { test, expect } from '@playwright/test';

const create = (request, url) => request.post('/api/links', { data: { url } });

test('GET /health reports ok', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('POST /api/links returns 201 with code, short_url and url', async ({ request, baseURL }) => {
  const res = await create(request, 'https://example.com/a/b?x=1');
  expect(res.status()).toBe(201);

  const body = await res.json();
  expect(body.code).toMatch(/^[A-Za-z0-9]{8}$/);
  expect(body.short_url).toBe(`${baseURL}/s/${body.code}`);
  expect(body.url).toBe('https://example.com/a/b?x=1');
});

test('GET /s/{code} answers 307 with the exact destination', async ({ request }) => {
  const destination = 'https://example.com/path?q=1&r=two#section';
  const { code } = await (await create(request, destination)).json();

  const res = await request.get(`/s/${code}`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toBe(destination);
});

test('plain http destinations are accepted', async ({ request }) => {
  expect((await create(request, 'http://example.org')).status()).toBe(201);
});

for (const [name, url] of [
  ['ftp scheme', 'ftp://example.com'],
  ['javascript scheme', 'javascript:alert(1)'],
  ['username and password', 'https://u:p@example.com'],
  ['username only', 'https://u@example.com'],
  ['not a URL', 'hello world'],
]) {
  test(`rejects ${name} with 422`, async ({ request }) => {
    expect((await create(request, url)).status()).toBe(422);
  });
}

test('rejects a missing url field with 422', async ({ request }) => {
  expect((await request.post('/api/links', { data: {} })).status()).toBe(422);
});

for (const [name, code, status] of [
  ['unknown code', 'ZZZZZZZZ', 404],
  ['code that is too short', 'abc', 422],
  ['code with a symbol', 'abcd-123', 422],
]) {
  test(`GET /s/ with ${name} returns ${status}`, async ({ request }) => {
    expect((await request.get(`/s/${code}`, { maxRedirects: 0 })).status()).toBe(status);
  });
}

test('API docs and OpenAPI schema are served', async ({ request }) => {
  expect((await request.get('/docs')).status()).toBe(200);
  expect((await (await request.get('/openapi.json')).json()).info.title).toBe('URL Shortener');
});

test('20 links get 20 distinct codes', async ({ request }) => {
  const codes = new Set();
  for (let i = 0; i < 20; i++) codes.add((await (await create(request, `https://example.com/${i}`)).json()).code);
  expect(codes.size).toBe(20);
});
