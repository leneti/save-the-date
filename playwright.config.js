import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4173;
const baseURL = `http://localhost:${PORT}`;

const { defaultBrowserType: _ignored, ...iphoneSE } = devices['iPhone SE'];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: 'npm run serve',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] } }, // WebKit
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    {
      // 320px-wide phone forced onto Chromium
      name: 'small',
      use: {
        ...iphoneSE,
        browserName: 'chromium',
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
