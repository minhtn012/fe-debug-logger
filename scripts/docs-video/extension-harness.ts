import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type BrowserContext, type FrameLocator, type Page } from '@playwright/test'

/**
 * Chạy extension thật trong Chromium của Playwright để quay video.
 *
 * Popup trên toolbar không bấm được bằng Playwright và không nằm trong video của trang, nên
 * bản copy dùng để quay cho phép nhúng popup.html vào trang dưới dạng iframe, đặt ngay dưới một
 * icon giả ở góc phải trên. Iframe nằm trong tab của trang nên `tabs.query({active, currentWindow})`
 * của popup vẫn trả về đúng tab đó. Chỉ bản copy bị sửa, mã nguồn extension giữ nguyên.
 */

const REPO = resolve(__dirname, '../..')
const SKIP = new Set(['.git', 'node_modules', 'scripts', 'test-results', 'plans', 'imgs-store', 'docs', 'fe-debug', 'mcp-server'])

/** Copy extension vào outDir/ext, mở popup + icon cho trang nhúng, và cho window.close() của popup báo trang đóng iframe. */
export function prepareExtension(outDir: string): string {
  const ext = resolve(outDir, 'ext')
  rmSync(ext, { recursive: true, force: true })
  // Từng mục cấp trên cùng: ext nằm trong test-results của chính repo.
  for (const name of readdirSync(REPO)) {
    if (SKIP.has(name) || name.startsWith('.') || name.endsWith('.zip') || name.startsWith('package')) continue
    cpSync(resolve(REPO, name), resolve(ext, name), { recursive: true })
  }
  const manifestPath = resolve(ext, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.web_accessible_resources = [
    { resources: ['popup.html', 'popup.css', 'popup.js', 'icons/icon-48.png'], matches: ['<all_urls>'] },
  ]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const popupJs = resolve(ext, 'popup.js')
  const shim = "if (window.top !== window) window.close = () => parent.postMessage({ __docsVideoPopup: 'close' }, '*');\n"
  writeFileSync(popupJs, shim + readFileSync(popupJs, 'utf8'))
  return ext
}

export async function launchWithExtension(outDir: string, size: { width: number; height: number }) {
  const ext = prepareExtension(outDir)
  const profile = resolve(outDir, 'profile')
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(resolve(outDir, 'downloads'), { recursive: true })
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: process.env.DOCS_VIDEO_HEADED ? false : true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: size,
    deviceScaleFactor: 1,
    locale: 'vi-VN',
    timezoneId: 'Asia/Saigon',
    acceptDownloads: true,
    downloadsPath: resolve(outDir, 'downloads'),
    recordVideo: { dir: resolve(outDir, 'raw-video'), size },
  })
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  return { context, extensionId, worker }
}

/**
 * Dọn khung hình trước khi quay: ẩn nút dev của Next.js, và đặt nút Góp ý của extension cao hơn
 * thanh phụ đề (vị trí nút lưu trong localStorage của site, người dùng thật kéo được bằng ⋮⋮).
 */
export async function prepPage(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) return
    try {
      if (!localStorage.getItem('__fe_fab_pos')) localStorage.setItem('__fe_fab_pos', JSON.stringify({ right: 24, bottom: 96 }))
    } catch {
      // Trang không có localStorage (about:blank, trang extension).
    }
    const hide = () => {
      if (!document.head || document.getElementById('__docs_hide_dev')) return
      const st = document.createElement('style')
      st.id = '__docs_hide_dev'
      st.textContent = 'nextjs-portal{display:none!important}'
      document.head.appendChild(st)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide)
    else hide()
  })
}

/** Icon giả trên "toolbar" + iframe popup. Trả về frame của popup để bấm nút thật bên trong. */
export function makePopup(page: Page, extensionId: string) {
  const base = `chrome-extension://${extensionId}`

  async function showIcon() {
    await page.evaluate((iconUrl) => {
      if (document.getElementById('__docs_ext_icon')) return
      const icon = document.createElement('div')
      icon.id = '__docs_ext_icon'
      icon.style.cssText =
        'position:fixed;top:10px;right:16px;z-index:2147483640;width:40px;height:40px;border-radius:10px;background:#fff;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;cursor:pointer'
      icon.innerHTML = `<img src="${iconUrl}" width="26" height="26" alt="FE Debug Logger">`
      document.body.appendChild(icon)
      window.addEventListener('message', (e) => {
        if (e.data?.__docsVideoPopup === 'close') document.getElementById('__docs_ext_popup')?.remove()
      })
    }, `${base}/icons/icon-48.png`)
  }

  return {
    icon: () => page.locator('#__docs_ext_icon'),
    showIcon,

    /** Mở popup ngay dưới icon. Gọi sau khi con trỏ đã bấm icon. */
    async open(): Promise<FrameLocator> {
      await page.evaluate((src) => {
        document.getElementById('__docs_ext_popup')?.remove()
        const f = document.createElement('iframe')
        f.id = '__docs_ext_popup'
        f.src = src
        f.style.cssText =
          'position:fixed;top:56px;right:16px;width:300px;height:520px;border:0;border-radius:10px;z-index:2147483641;' +
          'box-shadow:0 12px 40px rgba(0,0,0,.35);background:#fafafa'
        document.body.appendChild(f)
      }, `${base}/popup.html`)
      const frame = page.frameLocator('#__docs_ext_popup')
      await frame.locator('#toggleBtn').waitFor()
      // Khít chiều cao theo nội dung popup.
      const h = await frame.locator('.container').evaluate((c) => (c as HTMLElement).offsetHeight)
      await page.evaluate((hh) => {
        const f = document.getElementById('__docs_ext_popup') as HTMLIFrameElement | null
        if (f) f.style.height = `${hh}px`
      }, h)
      return frame
    },

    /** Popup thật đóng khi bấm ra ngoài; ở đây gỡ iframe. */
    async close() {
      await page.evaluate(() => document.getElementById('__docs_ext_popup')?.remove())
    },

    reviewUrl: `${base}/review.html`,
  }
}

export type Ctx = BrowserContext
