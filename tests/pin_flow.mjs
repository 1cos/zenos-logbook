// PIN choice flow with a temporary test person ZZTest (received PIN 3817), on a local copy. The caller deletes ZZTest afterwards.
import { webkit, chromium } from '/Users/massimilianozubboli/cw-probe/node_modules/playwright-core/index.mjs'
const URL = process.argv[2] || 'http://127.0.0.1:8793/'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m) }
const br = await webkit.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errs = []; pg.on('pageerror', e => errs.push(e.message))
if (process.env.DBG) pg.on('response', r => { if (r.url().includes('zenos-logbook-api')) r.text().then(t => console.log('resp', r.status(), t.slice(0, 70))).catch(()=>{}) })
const type = async d => { for (const c of d) await pg.locator(`.pad [data-n="${c}"]`).click() }
await pg.goto(URL); await pg.getByRole('button', { name: 'ZZTest' }).click(); await type('3817')
await pg.getByText('Choose your own PIN').waitFor({ timeout: 20000 }); ok(true, 'first sign-in asks to choose a PIN')
ok(await pg.locator('.ear').count() === 0, 'logbook hidden until PIN chosen')
await pg.screenshot({ path: 'tests/shots/pin_choose.png' })
await type('1111'); await pg.getByText('Too easy').waitFor(); ok(true, '1111 refused')
await type('3456'); await pg.getByText('Too easy').waitFor(); ok(true, '3456 refused')
await type('3817'); await pg.getByText('different from the old').waitFor(); ok(true, 'same as received refused')
await type('5290'); await pg.getByText('Type it again').waitFor(); await type('5291')
await pg.getByText('were different').waitFor(); ok(true, 'mismatch caught')
await type('5290'); await type('5290')
await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, 'PIN saved, logbook opens')
// reopen: no PIN question again
await pg.reload(); await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, 'reopen goes straight in')
// sign out, old PIN fails, new works
await pg.locator('#whoBtn').click(); await pg.waitForTimeout(500); await pg.screenshot({ path: 'tests/shots/pin_menu.png' }); await pg.locator('#out').click(); 
await pg.getByRole('button', { name: 'ZZTest' }).click(); await type('3817'); await pg.getByText('Wrong PIN').waitFor({ timeout: 15000 }); ok(true, 'received PIN no longer works')
await type('5290'); await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, 'new PIN works')
// Change PIN from the menu
await pg.locator('#whoBtn').click(); await pg.waitForTimeout(500); await pg.locator('#chg').click()
await pg.getByText('Enter your current PIN').waitFor(); await type('0000')
await type('7364'); await type('7364'); await pg.getByText('current PIN was wrong').waitFor({ timeout: 15000 }); ok(true, 'change PIN with wrong current refused')
await type('5290'); await type('7364'); await type('7364')
await pg.locator('.ear[data-k="daily"]').waitFor({ timeout: 20000 }); ok(true, 'PIN changed from the menu')
ok(errs.length === 0, 'no page errors ' + errs.join(' | '))
await br.close(); console.log(`RESULT ${pass} pass, ${fail} fail`)
