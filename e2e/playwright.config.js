import { defineConfig, devices } from '@playwright/test';

// Tests run against an already running stack (`docker compose up --build --wait`).
// Override the target with BASE_URL, e.g. BASE_URL=http://localhost:8080.
// Set E2E_DOCKER=1 to also run the tests that stop and recreate containers.
export default defineConfig({
  testDir: './tests',
  // The Docker tests stop the database, so nothing else may run at the same time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
});
