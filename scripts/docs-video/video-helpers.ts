import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'

/**
 * Dụng cụ quay video hướng dẫn: con trỏ giả + vòng sáng khi bấm (video Playwright không có con trỏ),
 * phụ đề bước ở đáy màn hình, và nhịp theo lời đọc: mỗi đoạn thao tác kéo dài ít nhất bằng lời đọc của nó.
 * Mốc bắt đầu từng đoạn ghi vào timeline.json để make-video.py đặt âm thanh đúng chỗ.
 */

/** Chạy trong trang: con trỏ, vòng sáng, khung phụ đề. Phụ đề giữ qua lần tải lại bằng sessionStorage. */
function overlayScript() {
  // Init script chạy cả trong iframe (popup extension nhúng vào trang): chỉ vẽ ở khung trên cùng.
  if (window.top !== window) return
  const setup = () => {
    if (document.getElementById('__v_cursor')) return
    const style = document.createElement('style')
    style.textContent = `
      #__v_cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .04s linear}
      .__v_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #e11d48;background:rgba(225,29,72,.18);z-index:2147483646;pointer-events:none;animation:__v_r .6s ease-out forwards}
      @keyframes __v_r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
      #__v_caption{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1100px;z-index:2147483645;pointer-events:none;
        background:rgba(15,23,42,.88);color:#fff;border-radius:14px;padding:12px 22px;font:500 19px/1.35 -apple-system,'Helvetica Neue',sans-serif;
        display:flex;gap:14px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.25)}
      #__v_caption:empty{display:none}
      #__v_caption b{background:#0f766e;border-radius:8px;padding:3px 10px;white-space:nowrap}
      #__v_caption i{font-style:normal;color:#99f6e4;white-space:nowrap;font-size:16px}`
    document.head.appendChild(style)
    const cursor = document.createElement('div')
    cursor.id = '__v_cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    cursor.style.transform = 'translate(-40px,-40px)'
    const caption = document.createElement('div')
    caption.id = '__v_caption'
    try {
      caption.innerHTML = sessionStorage.getItem('__v_caption') ?? ''
    } catch {
      // Trang trống không có sessionStorage.
    }
    document.body.append(cursor, caption)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup)
  else setup()
}

export interface Caption {
  step?: string
  text: string
  who?: string
}

export function makeDirector(page: Page, outDir: string, opts: { whoLabel?: string } = {}) {
  const whoLabel = opts.whoLabel ?? 'Tài khoản'
  const durations: Record<string, number> = JSON.parse(readFileSync(resolve(outDir, 'durations.json'), 'utf8'))
  const t0 = Date.now()
  const timeline: { id: string; t: number }[] = []
  let mouse = { x: 720, y: 450 }

  /** Chấm con trỏ + vòng sáng do director tự vẽ: lúc extension đóng băng trang, sự kiện chuột không tới được overlay. */
  async function drawCursor(x: number, y: number, ripple = false) {
    await page.evaluate(
      ([cx, cy, r]) => {
        const c = document.getElementById('__v_cursor')
        if (c) c.style.transform = `translate(${cx - 3}px,${cy - 2}px)`
        if (!r) return
        const d = document.createElement('div')
        d.className = '__v_ripple'
        d.style.left = `${cx}px`
        d.style.top = `${cy}px`
        document.body.appendChild(d)
        setTimeout(() => d.remove(), 700)
      },
      [x, y, ripple] as const,
    )
  }

  /** Lướt chuột thật tới (x, y), con trỏ vẽ theo từng bước. */
  async function glide(x: number, y: number) {
    await page.evaluate(overlayScript)
    const steps = Math.max(12, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 18))
    const from = mouse
    for (let i = 1; i <= steps; i++) {
      const px = from.x + ((x - from.x) * i) / steps
      const py = from.y + ((y - from.y) * i) / steps
      await page.mouse.move(px, py)
      await drawCursor(px, py)
    }
    mouse = { x, y }
  }

  async function center(target: Locator, scroll = true) {
    if (scroll) {
      await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      await page.waitForTimeout(450)
    }
    const box = await target.boundingBox()
    if (!box) throw new Error(`Không thấy phần tử để bấm: ${target}`)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async function caption(c: Caption | null) {
    // Trang của extension (review) không chạy init script: gắn overlay tại chỗ, idempotent.
    await page.evaluate(overlayScript)
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const html = c ? `${c.step ? `<b>${esc(c.step)}</b>` : ''}<span>${esc(c.text)}</span>${c.who ? `<i>${esc(whoLabel)}: ${esc(c.who)}</i>` : ''}` : ''
    await page.evaluate((h) => {
      try {
        sessionStorage.setItem('__v_caption', h)
      } catch {
        // Màn tiêu đề là trang trống, không có sessionStorage.
      }
      const el = document.getElementById('__v_caption')
      if (el) el.innerHTML = h
    }, html)
  }

  return {
    async install() {
      await page.addInitScript(overlayScript)
    },

    caption,

    /** Một đoạn lời đọc: ghi mốc, chạy thao tác, rồi chờ cho hết lời đọc (thêm chút nghỉ). */
    async segment(id: string, cap: Caption | null, actions: () => Promise<void> = async () => {}) {
      const dur = durations[id]
      if (dur === undefined) throw new Error(`Thiếu lời đọc cho đoạn "${id}"`)
      if (cap) await caption(cap)
      const start = Date.now()
      timeline.push({ id, t: (start - t0) / 1000 })
      await actions()
      const left = dur * 1000 + 600 - (Date.now() - start)
      if (left > 0) await page.waitForTimeout(left)
    },

    /** Màn tiêu đề ở đầu/cuối video, dựng bằng HTML trên trang trống. Nền phẳng: gradient bị bộ nén VP8 của video quay làm thành dải sọc nhảy từng khung hình. */
    async titleCard(kicker: string, title: string, subtitle: string) {
      await page.setContent(`<style>*{margin:0}body{height:100vh;background:#0b3b66;border-left:14px solid #14b8a6;box-sizing:border-box;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 120px;font-family:-apple-system,'Helvetica Neue',sans-serif}
        .k{font-size:22px;letter-spacing:.2em;text-transform:uppercase;color:#5eead4}h1{font-size:80px;margin:18px 0 26px}p{font-size:30px;opacity:.9;line-height:1.4}</style>
        <div class="k">${kicker}</div><h1>${title}</h1><p>${subtitle}</p>`)
    },

    /** Cuộn phần tử ra giữa màn hình, lướt chuột tới rồi bấm — người xem thấy được tay đi đâu. */
    async click(target: Locator) {
      const to = await center(target)
      await glide(to.x, to.y)
      await page.waitForTimeout(150)
      await drawCursor(to.x, to.y, true)
      await target.click()
      await page.waitForTimeout(250)
    },

    /** Rê chuột tới phần tử mà không bấm (khung chọn của extension hiện theo). Không cuộn: trang có thể đang đóng băng. */
    async hover(target: Locator) {
      const to = await center(target, false)
      await glide(to.x, to.y)
    },

    /** Bấm theo toạ độ, bỏ qua kiểm tra của Playwright: lúc chọn element, lớp khiên của extension phủ lên trang. */
    async clickAt(target: Locator) {
      const to = await center(target, false)
      await glide(to.x, to.y)
      await page.waitForTimeout(200)
      await drawCursor(to.x, to.y, true)
      await page.mouse.click(to.x, to.y)
      await page.waitForTimeout(250)
    },

    /** Kéo chuột từ a tới b (chọn vùng chụp). */
    async drag(a: { x: number; y: number }, b: { x: number; y: number }) {
      await glide(a.x, a.y)
      await drawCursor(a.x, a.y, true)
      await page.mouse.down()
      const steps = 30
      for (let i = 1; i <= steps; i++) {
        const px = a.x + ((b.x - a.x) * i) / steps
        const py = a.y + ((b.y - a.y) * i) / steps
        await page.mouse.move(px, py)
        await drawCursor(px, py)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      mouse = b
    },

    /** Gõ từng chữ để người xem theo kịp. */
    async type(target: Locator, text: string, delay = 28) {
      await this.click(target)
      await target.pressSequentially(text, { delay })
    },

    save(videoPath: string | undefined) {
      writeFileSync(resolve(outDir, 'timeline.json'), JSON.stringify({ video: videoPath, segments: timeline }, null, 2))
    },
  }
}
