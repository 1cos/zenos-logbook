// Published site check (no writes): manifest + icons served, sign in as Max, topics shown, sign out.
import { webkit } from '/Users/massimilianozubboli/cw-probe/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
const pin = fs.readFileSync(process.env.HOME + '/.brigade_secrets/zenos_logbook_pins.txt', 'utf8').match(/^Max: (\d{4})/m)[1]
const SITE = 'https://1cos.github.io/zenos-logbook/'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'sw.js']) ok((await fetch(SITE + f)).status === 200, 'served ' + f)
const br = await webkit.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errs = []; pg.on('pageerror', e => errs.push(e.message))
await pg.goto(SITE); await pg.getByRole('button', { name: 'Max' }).click()
for (const d of pin) await pg.locator(`[data-n="${d}"]`).click()
await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, 'signed in on the published site')
ok(await pg.locator('.ear').count() === 7, '6 topics + add')
await pg.screenshot({ path: process.argv[2] + '/live_daily.png' })
await pg.locator('#whoBtn').click(); await pg.locator('#out').click()
await pg.getByText('Who are you?').waitFor(); ok(true, 'signed out')
ok(errs.length === 0, 'no page errors ' + errs.join(' | '))
await br.close(); console.log(`RESULT ${pass} pass, ${fail} fail`)
