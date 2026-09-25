import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchWithExtension, makePopup, prepPage } from './extension-harness'
import { makeDirector } from './video-helpers'

/**
 * Video "Hướng dẫn sử dụng FE Debug Logger", demo trên website reiwapharm (dev server localhost:3220).
 * Extension thật chạy trong Chromium của Playwright; popup hiện dạng iframe dưới icon giả (xem extension-harness.ts).
 * Every segment id must exist in narration/huong-dan-su-dung.json.
 * Run: DOCS_VIDEO_BASE_URL=http://localhost:3220 python3 ~/.claude/skills/fe-guide-video/scripts/make-video.py huong-dan-su-dung
 */
const outDir = process.env.DOCS_VIDEO_OUT!
const SITE = process.env.DOCS_VIDEO_BASE_URL ?? 'http://localhost:3220'
const SIZE = { width: 1600, height: 900 }

/** File export mới nhất của extension (Chrome lưu tên dạng GUID trong thư mục download của Playwright). */
function latestExportMarkdown(): string {
  const dir = resolve(outDir, 'downloads')
  const newest = readdirSync(dir)
    .map((f) => resolve(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  const buf = readFileSync(newest)
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b
  return isZip ? execFileSync('unzip', ['-p', newest, 'debug-log.md']).toString('utf8') : buf.toString('utf8')
}

test('video huong-dan-su-dung', async () => {
  test.setTimeout(900_000)
  const { context, extensionId } = await launchWithExtension(outDir, SIZE)
  const blank = context.pages()[0]
  // Trang mới: video của nó bắt đầu cùng lúc với đồng hồ của director.
  const page = await context.newPage()
  await blank?.close()
  const v = makeDirector(page, outDir)
  await v.install()
  await prepPage(page)
  const popup = makePopup(page, extensionId)
  const fab = page.locator('fe-feedback-fab')
  const picker = page.locator('#__fe_debug_annotation_root__')

  await v.titleCard(
    'Hướng dẫn sử dụng · Chrome extension',
    'FE Debug Logger',
    'Feedback: góp ý giao diện · Record: ghi log lỗi<br>Xuất Markdown cho Claude Code',
  )
  await v.segment('intro', null)

  // ── Phần 1: Feedback ─────────────────────────────────────────────
  const f1 = { step: 'Feedback 1/8', text: 'Bấm icon extension, chọn "Feedback"' }
  await v.segment('f1', f1, async () => {
    await page.goto(`${SITE}/`)
    await v.caption(f1)
    await popup.showIcon()
    await page.waitForTimeout(600)
    await v.click(popup.icon())
    const p = await popup.open()
    await page.waitForTimeout(700)
    await v.click(p.locator('#feedbackBtn'))
    await expect(p.locator('#feedbackStatus')).toContainText('Đang bật trên')
    await page.waitForTimeout(1500)
    await popup.close()
    await expect(fab.getByRole('button', { name: 'Góp ý' })).toBeVisible()
  })

  await v.segment('f2', { step: 'Feedback 2/8', text: 'Bấm "Góp ý", đặt tên phiên, bấm "Bắt đầu"' }, async () => {
    await v.click(fab.getByRole('button', { name: 'Góp ý' }))
    await v.type(fab.locator('#nameInput'), 'Góp ý trang chủ', 45)
    await v.click(fab.getByRole('button', { name: 'Bắt đầu' }))
    await expect(fab.getByText('Góp ý trang chủ · 0 item')).toBeVisible()
  })

  const stat = page.locator('.home-stats__item').nth(1) // vòng "97+" (số chạy hiệu ứng đếm)
  await v.segment('f3', { step: 'Feedback 3/8', text: 'Bấm "Chọn element", rê chuột rồi bấm vào phần cần góp ý' }, async () => {
    await page.locator('.home-about__title').evaluate((el) =>
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' }),
    )
    await page.waitForTimeout(1200)
    await v.click(fab.getByRole('button', { name: 'Chọn element' }))
    await expect(fab.getByText('Đang chọn element')).toBeVisible()
    await v.hover(page.getByRole('link', { name: 'Tìm hiểu về TV TPI' }))
    await page.waitForTimeout(500)
    await v.hover(page.getByText('Được thành lập vào năm 2023'))
    await page.waitForTimeout(500)
    await v.hover(stat)
    await page.waitForTimeout(700)
    await v.clickAt(stat)
    await expect(picker.locator('#noteInput')).toBeVisible()
  })

  await v.segment('f4', { step: 'Feedback 4/8', text: 'Ghi chú, chọn loại Bug / Góp ý, bấm "Lưu"' }, async () => {
    await v.type(picker.locator('#noteInput'), 'Chữ dưới các con số xuống dòng không đều (1 đến 3 dòng), nhìn lệch', 30)
    await v.hover(picker.locator('#kindSelect'))
    await expect(picker.locator('#kindSelect')).toHaveValue('bug')
    await page.waitForTimeout(500)
    await v.click(picker.locator('#saveBtn'))
    await expect(picker.locator('#noteInput')).toBeHidden()
  })

  const cta = page.getByRole('link', { name: 'Tìm hiểu về TV TPI' })
  await v.segment('f5', { step: 'Feedback 5/8', text: 'Góp ý tiếp: chọn nút "Tìm hiểu về TV TPI", loại "Góp ý"' }, async () => {
    await page.waitForTimeout(600)
    await v.hover(cta)
    await page.waitForTimeout(600)
    await v.clickAt(cta)
    await v.type(picker.locator('#noteInput'), 'Nút mở website tvtpi.vn ở tab mới: nên thêm icon link ngoài', 30)
    await v.hover(picker.locator('#kindSelect'))
    await picker.locator('#kindSelect').selectOption('suggestion')
    await page.waitForTimeout(500)
    await v.click(picker.locator('#saveBtn'))
    await expect(picker.locator('#noteInput')).toBeHidden()
  })

  const f6 = { step: 'Feedback 6/8', text: 'Bấm "Dừng chọn", rồi "Xong" để mở trang review' }
  await v.segment('f6', f6, async () => {
    await page.waitForTimeout(500)
    await v.click(fab.getByRole('button', { name: 'Dừng chọn' }))
    await expect(fab.getByText('Góp ý trang chủ · 2 item')).toBeVisible()
    await page.waitForTimeout(1500)
    const opened = context.waitForEvent('page')
    await v.click(fab.getByRole('button', { name: 'Xong' }))
    // Extension mở review ở tab mới; video chỉ quay một tab nên mở cùng URL trong tab đang quay.
    const review = await opened
    await review.waitForLoadState()
    const url = review.url()
    await review.close()
    await page.goto(url)
    await v.caption(f6)
    await expect(page.getByRole('heading', { name: 'Góp ý trang chủ' })).toBeVisible()
  })

  await v.segment('f7', { step: 'Feedback 7/8', text: 'Xem lại, sửa ghi chú, đổi loại; bên dưới là lỗi console và network' }, async () => {
    await expect(page.locator('article.item')).toHaveCount(2)
    const first = page.locator('article.item').first()
    await v.hover(first.locator('.shot'))
    await page.waitForTimeout(800)
    const note = first.locator('textarea')
    await v.click(note)
    await note.press('End')
    await note.pressSequentially(' (màn 1600px)', { delay: 40 })
    await v.hover(page.locator('article.item').nth(1).locator('select'))
    await page.waitForTimeout(800)
    await v.click(page.locator('#tabNetwork'))
    await page.waitForTimeout(800)
    await v.click(page.locator('#tabConsole'))
  })

  await v.segment('f8', { step: 'Feedback 8/8', text: '"Copy MD" để dán vào Claude Code, hoặc "Export MD" / "Export ZIP"' }, async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await v.click(page.locator('#copyBtn'))
    await page.waitForTimeout(1200)
    await v.hover(page.locator('#exportMdBtn'))
    await page.waitForTimeout(600)
    await v.click(page.locator('#exportZipBtn'))
    await page.waitForTimeout(1200)
  })

  // ── Phần 2: Record ───────────────────────────────────────────────
  await v.caption(null)
  await v.titleCard('Phần 2', 'Record', 'Ghi log lỗi trong lúc tái hiện bug<br>Annotate · Screenshot · Export')
  await v.segment('p2', null)

  const r1 = { step: 'Record 1/6', text: 'Tắt Feedback, giữ các loại dữ liệu cần ghi, bấm "Start"' }
  await v.segment('r1', r1, async () => {
    await page.goto(`${SITE}/`)
    await v.caption(r1)
    await popup.showIcon()
    await page.waitForTimeout(500)
    await v.click(popup.icon())
    const p = await popup.open()
    await page.waitForTimeout(600)
    await v.click(p.locator('#feedbackBtn'))
    await expect(p.locator('#feedbackBtn')).toHaveText('Feedback')
    await v.hover(p.locator('#optConsole'))
    await page.waitForTimeout(400)
    await v.hover(p.locator('#optComponentState'))
    await page.waitForTimeout(400)
    await v.click(p.locator('#toggleBtn'))
    await expect(p.locator('#status')).toHaveText('Recording...')
    await page.waitForTimeout(1200)
    await popup.close()
    await expect(fab).toHaveCount(0)
  })

  const r2 = { step: 'Record 2/6', text: 'Thao tác trên trang để tái hiện lỗi' }
  await v.segment('r2', r2, async () => {
    await v.click(page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Sản phẩm' }))
    await expect(page).toHaveURL(/\/san-pham/)
    await v.caption(r2)
    await popup.showIcon()
    await v.click(page.getByRole('group', { name: 'Nhóm sản phẩm' }).getByRole('button', { name: /Chống nhiễm trùng/ }))
    await page.waitForTimeout(800)
    await v.type(page.getByRole('searchbox', { name: 'Tìm theo tên thuốc / hoạt chất' }), 'ampi', 120)
    await page.waitForTimeout(800)
    await expect(page.getByText('ReiwAmpi').first()).toBeVisible()
  })

  const r3 = { step: 'Record 3/6', text: '"Annotate": chọn element, ghi chú, mức độ, nhãn, bấm "Save"' }
  await v.segment('r3', r3, async () => {
    await v.click(popup.icon())
    const p = await popup.open()
    await page.waitForTimeout(500)
    await v.click(p.locator('#annotateBtn'))
    await expect(page.locator('#__docs_ext_popup')).toHaveCount(0)
    const heading = page.getByRole('heading', { name: 'Tất cả sản phẩm' })
    await v.hover(heading)
    await page.waitForTimeout(600)
    await v.clickAt(heading)
    await v.type(picker.locator('#noteInput'), 'Lọc "Chống nhiễm trùng" + tìm "ampi" nhưng tiêu đề vẫn là "Tất cả sản phẩm"', 28)
    await v.hover(picker.locator('#severitySelect'))
    await picker.locator('#severitySelect').selectOption('minor')
    await v.click(picker.locator('.tag[data-tag="Logic"]'))
    await v.click(picker.locator('#saveBtn'))
    await expect(picker.locator('#noteInput')).toBeHidden()
    await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
  })

  await v.segment('r4', { step: 'Record 4/6', text: '"Screenshot ▾" → "Select Region", kéo chọn vùng, ghi chú cho ảnh' }, async () => {
    await v.click(popup.icon())
    const p = await popup.open()
    await page.waitForTimeout(400)
    await v.click(p.locator('#screenshotBtn'))
    await page.waitForTimeout(500)
    await v.click(p.locator('#ssRegion'))
    await expect(page.locator('#__fe_debug_region_overlay__')).toBeVisible()
    await page.waitForTimeout(400)
    await v.drag({ x: 470, y: 250 }, { x: 1420, y: 650 })
    await expect(page.locator('#__fe_debug_region_overlay__')).toHaveCount(0)
    const shotNote = page.locator('#__fe_debug_shot_note__')
    await expect(shotNote.locator('textarea')).toBeVisible()
    await page.waitForTimeout(500)
    await v.type(shotNote.locator('textarea'), 'Danh sách sau khi lọc "ampi": chỉ còn 1 sản phẩm', 28)
    await v.click(shotNote.locator('.save'))
    await expect(shotNote).toHaveCount(0)
    await page.waitForTimeout(600)
  })

  await v.segment('r5', { step: 'Record 5/6', text: 'Bấm "Stop", rồi "Copy" hoặc "Export"' }, async () => {
    await v.click(popup.icon())
    const p = await popup.open()
    await expect(p.locator('#annotationCount')).toHaveText('1 annotation · 2 screenshots')
    await page.waitForTimeout(500)
    await v.click(p.locator('#toggleBtn'))
    await expect(p.locator('#status')).toHaveText('Idle')
    await expect(p.locator('#entryCount')).toContainText('captured')
    await page.waitForTimeout(1200)
    await v.click(p.locator('#copyBtn'))
    await page.waitForTimeout(900)
    await v.click(p.locator('#exportBtn'))
    await page.waitForTimeout(2500)
    await popup.close()
  })

  const md = latestExportMarkdown()
  expect(md).toContain('# FE Debug Log')
  const r6 = { step: 'Record 6/6', text: 'debug-log.md: thông tin phiên, annotation, ảnh chụp kèm ghi chú, thao tác, network' }
  await v.segment('r6', r6, async () => {
    await page.setContent(
      `<style>*{margin:0}body{background:#0f172a;color:#e2e8f0;font:16px/1.55 ui-monospace,Menlo,monospace}
       header{position:sticky;top:0;background:#1e293b;padding:14px 32px;font:600 17px -apple-system,sans-serif;color:#99f6e4}
       main{padding:24px 32px 900px;white-space:pre-wrap}main div{min-height:1.55em}
       main .h{color:#5eead4;font-weight:700;font-size:20px;margin-top:10px;scroll-margin-top:70px}</style>
       <header>debug-log.md · file Markdown trong ZIP đã export</header><main></main>`,
    )
    await page.locator('main').evaluate((main, text) => {
      for (const line of text.split('\n')) {
        const d = document.createElement('div')
        d.textContent = line
        if (/^#{1,3} /.test(line)) d.className = /^## /.test(line) ? 'h h2' : 'h'
        main.appendChild(d)
      }
    }, md)
    await v.caption(r6)
    await page.waitForTimeout(2500)
    // Chỉ nhảy qua các mục lớn (##): nhảy từng mục con thì hình chạy lâu hơn lời đọc.
    const sections = page.locator('main .h2')
    const n = await sections.count()
    for (let i = 1; i < n; i++) {
      await sections.nth(i).evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      await page.waitForTimeout(1800)
    }
  })

  await v.caption(null)
  await v.titleCard('FE Debug Logger', 'Xong!', 'Feedback để góp ý giao diện · Record để ghi lỗi khi tái hiện bug')
  await v.segment('outro', null)

  v.save(await page.video()?.path())
  await context.close()
})
