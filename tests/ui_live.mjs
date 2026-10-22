// Live UI test on a local copy (port 8793): sign in as a temporary test person (LB_WHO, LB_PIN), write one entry with photo + one comment, check they show; the caller deletes the test person and data.
import { webkit, chromium } from '/Users/massimilianozubboli/cw-probe/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
// test person and PIN come from the environment (a temporary person, never a real one)
const WHO = process.env.LB_WHO, pin = process.env.LB_PIN
const shots = process.argv[2]
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
for (const [bn, B] of [['webkit', webkit], ['chromium', chromium]]) {
  const br = await B.launch()
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const errs = []; pg.on('pageerror', e => errs.push(e.message))
  await pg.goto('http://127.0.0.1:8793/')
  await pg.getByRole('button', { name: WHO }).click()
  await pg.getByRole('button', { name: '0', exact: true }).waitFor()
  // wrong PIN first
  for (const d of '0000') await pg.locator(`[data-n="${d}"]`).click()
  await pg.getByText('Wrong PIN').waitFor({ timeout: 15000 }); ok(true, bn + ' wrong PIN refused')
  for (const d of pin) await pg.locator(`[data-n="${d}"]`).click()
  await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 })
  ok(await pg.locator('.ear').count() >= 7, bn + ' 6 topics + add button shown')
  if (bn === 'webkit') await pg.screenshot({ path: shots + '/1_daily.png' })
  await pg.locator('.ear[data-k="purchases"]').click()
  await pg.getByRole('button', { name: '+ Add entry' }).click()
  await pg.locator('#txt').fill(`TEST ${bn} Claude — da cancellare`)
  await pg.locator('#amt').fill('9.99')
  await pg.locator('#photo').setInputFiles(process.env.HOME + '/zenos-logbook/web/icon-192.png')
  await pg.getByText('Photo added').waitFor()
  if (bn === 'webkit') await pg.screenshot({ path: shots + '/2_add.png' })
  await pg.locator('#save').click()
  const row = pg.locator('.row', { hasText: `TEST ${bn} Claude` })
  await row.waitFor({ timeout: 20000 }); ok(true, bn + ' entry saved and listed')
  ok((await row.innerText()).includes('$9.99'), bn + ' amount shown')
  ok(await row.locator('img').count() === 1, bn + ' photo shown')
  await row.click()
  await pg.locator('#c').fill('TEST comment')
  await pg.locator('#cSave').click()
  await pg.locator('.cm', { hasText: 'TEST comment' }).waitFor({ timeout: 20000 }); ok(true, bn + ' comment saved')
  if (bn === 'webkit') await pg.screenshot({ path: shots + '/3_entry.png' })
  await pg.locator('.x').click()
  ok((await row.innerText()).includes('1 comment'), bn + ' comment count in list')
  // reload keeps the session
  await pg.reload(); await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, bn + ' still signed in after reload')
  ok(errs.length === 0, bn + ' no page errors ' + errs.join(' | '))
  await br.close()
}
console.log(`RESULT ${pass} pass, ${fail} fail`)
