import { chromium } from 'playwright'
import fs from 'node:fs'

const SITE = 'https://411332060-code.github.io/chat-room/'
const OUT = process.cwd() + '\\shots\\'
fs.mkdirSync(OUT, { recursive: true })

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctxA = await browser.newContext({ viewport: { width: 390, height: 780 } })
const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } })
const A = await ctxA.newPage()
const B = await ctxB.newPage()
const logs = { A: [], B: [] }
for (const [k, p] of [['A', A], ['B', B]]) {
  p.on('console', (m) => m.type() === 'error' && logs[k].push(m.text()))
  p.on('pageerror', (e) => logs[k].push('pageerror: ' + e.message))
}

async function enter(page, label) {
  await page.goto(SITE, { waitUntil: 'networkidle' })
  await page.getByLabel('暱稱').fill(`AIgrader${label}`) // entry screen: pick a name, the server adds #NNN
  await page.getByRole('button', { name: '進入聊天室' }).click()
  await page.locator('textarea').waitFor({ timeout: 15000 })
  record(`${label} enters the chat room as AIgrader${label}`, true)
}

const bodyText = (page) => page.locator('.list').innerText()
const waitText = (page, text, timeout = 8000) =>
  page.locator('.list', { hasText: text }).waitFor({ timeout }).then(() => true, () => false)

try {
  // B1/B2: enter, presence, join notice
  await enter(A, 'A')
  await enter(B, 'B')

  await B.waitForFunction(() => /線上 2 人/.test(document.querySelector('button.online')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  const onlineB = await B.locator('button.online').innerText()
  const aSees2 = await A.waitForFunction(() => Number((document.querySelector('button.online')?.textContent ?? '').match(/線上 (\d+) 人/)?.[1]) >= 2, null, { timeout: 10000 }).then(() => true, () => false)
  record('A sees A and B online (at least 2)', aSees2, await A.locator('button.online').innerText())
  record('B sees A and B online (at least 2)', Number((onlineB.match(/線上 (\d+) 人/) ?? [])[1]) >= 2, onlineB)
  const joinNotice = await waitText(A, '加入了聊天室', 5000)
  record('A sees a join notice when B arrives', joinNotice)
  await A.locator('button.online').click()
  await B.locator('button.online').click()
  await A.screenshot({ path: OUT + 'phase2_online_list.png' })
  await A.locator('button.online').click()
  await B.locator('button.online').click()

  // typing indicator (A types, does not send)
  await A.locator('textarea').pressSequentially('[e2e] typing', { delay: 40 })
  const typing = await B.locator('.typing').filter({ hasText: '正在輸入' }).waitFor({ timeout: 6000 }).then(() => true, () => false)
  record('B sees "正在輸入…" while A types', typing, await B.locator('.typing').innerText())
  await B.screenshot({ path: OUT + 'phase2_typing.png' })
  await A.locator('textarea').fill('')

  // A -> B
  let t0 = Date.now()
  await A.locator('textarea').fill('[e2e] hello from A')
  await A.locator('textarea').press('Enter')
  const gotB = await waitText(B, '[e2e] hello from A')
  record('A -> B message arrives', gotB, gotB ? `${Date.now() - t0} ms` : '')
  // B -> A
  t0 = Date.now()
  await B.locator('textarea').fill('[e2e] hello from B')
  await B.locator('textarea').press('Enter')
  const gotA = await waitText(A, '[e2e] hello from B')
  record('B -> A message arrives', gotA, gotA ? `${Date.now() - t0} ms` : '')

  await A.locator('.msg.mine .status', { hasText: '已送出' }).last().waitFor({ timeout: 5000 }).catch(() => {})
  const status = await A.locator('.msg.mine .status').last().innerText()
  record('own message shows "已送出"', status.includes('已送出'), status)

  // XSS: must render as text
  await A.locator('textarea').fill('[e2e] <b id="xss-b">bold</b><img src=x onerror="window.__xss=1">')
  await A.locator('textarea').press('Enter')
  await waitText(B, '[e2e] <b id="xss-b">')
  const injected = await B.evaluate(() => !!document.querySelector('#xss-b') || window.__xss === 1)
  record('HTML is shown as text (not executed)', !injected)

  // counter
  await A.locator('textarea').fill('a'.repeat(501))
  const countText = await A.locator('.count').innerText()
  const disabled = await A.locator('button[type=submit]').isDisabled()
  record('counter shows 501 / 500 and disables send', countText.includes('501 / 500') && disabled, countText)
  await A.locator('textarea').fill('')

  // mobile: no horizontal scroll
  for (const [k, p] of [['A', A], ['B', B]]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    record(`${k} (390px wide) has no horizontal scroll`, !overflow)
  }

  // rate limit: 6 quick messages -> 6th rejected
  for (let i = 1; i <= 6; i++) {
    await B.locator('textarea').fill(`[e2e] rate ${i}`)
    await B.locator('textarea').press('Enter')
    await B.waitForTimeout(120)
  }
  const limited = await B.locator('.status.failed', { hasText: '發言太快' }).first().waitFor({ timeout: 8000 }).then(() => true, () => false)
  record('6 quick messages: one is rejected with "發言太快了"', limited)
  await B.screenshot({ path: OUT + 'phase2_rate_limit.png' })

  // offline banner on B, then recover
  await ctxB.setOffline(true)
  const banner = await B.locator('.banner').waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
  record('offline shows "重新連線中…" banner', banner)
  await B.screenshot({ path: OUT + 'phase2_reconnecting.png' })
  await ctxB.setOffline(false)
  const recovered = await B.locator('.banner').waitFor({ state: 'hidden', timeout: 30000 }).then(() => true, () => false)
  record('banner disappears after coming back online', recovered)
  if (recovered) {
    t0 = Date.now()
    await A.locator('textarea').fill('[e2e] after reconnect')
    await A.locator('textarea').press('Enter')
    record('messages flow again after reconnect', await waitText(B, '[e2e] after reconnect', 10000), `${Date.now() - t0} ms`)
  }

  // names: typed name + fixed 3-digit number, shown to the other side
  const nameOnB = await B.locator('.msg', { hasText: '[e2e] hello from A' }).last().locator('.name').innerText()
  record('B sees A as "AIgraderA#NNN"', /^AIgraderA#\d{3}$/.test(nameOnB), nameOnB)

  // a third person joins and leaves cleanly (button): B's list must follow, with notices
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 780 } })
  const C = await ctxC.newPage()
  await enter(C, 'C')
  await B.waitForTimeout(2500) // let B's list settle with C in it
  // relative counts: other real visitors may be online at the same time
  const n = (s) => Number((s.match(/線上 (\d+) 人/) ?? [])[1])
  const baseAfterC = n(await B.locator('button.online').innerText())
  await C.getByRole('button', { name: '離開' }).click()
  const dropped = await B.waitForFunction((x) => Number((document.querySelector('button.online')?.textContent ?? '').match(/線上 (\d+) 人/)?.[1]) === x - 1, baseAfterC, { timeout: 10000 }).then(() => true, () => false)
  record('B sees the count drop by 1 when C leaves', dropped, `${baseAfterC} -> ${await B.locator('button.online').innerText()}`)
  record('B sees a leave notice for C', await waitText(B, '離開了聊天室', 5000))
  await ctxC.close()

  // reload keeps history and nickname
  const nickBefore = await A.locator('.msg.mine .name').first().innerText()
  await A.reload({ waitUntil: 'networkidle' })
  await A.getByRole('button', { name: '進入聊天室' }).click()
  await A.locator('textarea').waitFor({ timeout: 15000 })
  const history = await waitText(A, '[e2e] hello from A')
  const nickAfter = await A.locator('.msg.mine .name').first().innerText()
  record('after reload: history is there and nickname unchanged', history && nickBefore === nickAfter, `${nickBefore} -> ${nickAfter}`)
  await A.screenshot({ path: OUT + 'phase2_chat.png' })

  // leave -> B sees leave notice and count 1
  await A.getByRole('button', { name: '離開' }).click()
  const leftNotice = await waitText(B, '離開了聊天室', 10000)
  record('B sees a leave notice after A leaves', leftNotice)
} catch (e) {
  record('script crashed', false, String(e).split('\n')[0])
  await A.screenshot({ path: OUT + 'crash_A.png' }).catch(() => {})
  await B.screenshot({ path: OUT + 'crash_B.png' }).catch(() => {})
}

await B.getByRole('button', { name: '離開' }).click().catch(() => {}) // leave cleanly: no ghost in the list
await B.waitForTimeout(1500)
console.log('\nconsole errors A:', logs.A.slice(0, 5))
console.log('console errors B:', logs.B.slice(0, 5))
fs.writeFileSync(OUT + 'e2e_result.json', JSON.stringify({ url: SITE, results, logs }, null, 2))
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; screenshots in ${OUT}`)
await browser.close()
