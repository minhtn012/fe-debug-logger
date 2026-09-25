import { defineConfig } from '@playwright/test'

/**
 * Records narrated guide videos of the live app. Not a regression suite: run through make-video.py.
 * 1600×900 so app text stays readable full screen.
 */
const port = Number(process.env.DOCS_VIDEO_PORT ?? 3220)
const size = { width: 1600, height: 900 }

export default defineConfig({
  testDir: '.',
  testMatch: '*.video.ts',
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/docs-video/playwright',
  use: {
    baseURL: process.env.DOCS_VIDEO_BASE_URL ?? `http://localhost:${port}`,
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL ?? 'chrome'),
    locale: 'vi-VN',
    timezoneId: 'Asia/Saigon',
    viewport: size,
    deviceScaleFactor: 1,
    actionTimeout: 15_000,
    video: { mode: 'on', size },
  },
  webServer: process.env.DOCS_VIDEO_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port} --strictPort`,
        url: `http://localhost:${port}`,
        reuseExistingServer: false,
        timeout: 90_000,
        cwd: '../..',
      },
})
