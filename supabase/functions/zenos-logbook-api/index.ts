// zenos-logbook-api — the only door of Zeno's Logbook (B-60). The app ships no Supabase key.
// Login = name + 4-digit PIN (bcrypt in the database). Every other call carries the session token.
// Writes only to the logbook_* tables and the private bucket logbook-photos. Nothing else in Brigade is read or written.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUILD = 'logbook-1.1'
const ORIGINS = ['https://1cos.github.io', 'http://localhost:8793', 'http://127.0.0.1:8793']
const svc = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const BUCKET = 'logbook-photos'

class HttpError extends Error { constructor(public status: number, public code: string) { super(code) } }
const must = <T>(r: { data: T | null; error: unknown }) => { if (r.error) throw r.error; return r.data as T }
const cors = (o: string) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
})
async function sha256hex(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')
}
const clean = (s: unknown, max: number) => typeof s === 'string' ? s.trim().slice(0, max) : ''

async function auth(req: Request) {
  const h = req.headers.get('authorization') || ''
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(tok)) throw new HttpError(401, 'unauthorized')
  const s = must(await svc.from('logbook_sessions').select('id,person_id,expires_at,revoked_at').eq('token_hash', await sha256hex(tok)).maybeSingle()) as any
  if (!s || s.revoked_at || new Date(s.expires_at) <= new Date()) throw new HttpError(401, 'session_expired')
  const p = must(await svc.from('logbook_people').select('id,name,active,pin_chosen').eq('id', s.person_id).maybeSingle()) as any
  if (!p || !p.active) throw new HttpError(401, 'unauthorized')
  return { id: p.id as number, name: p.name as string, session: s.id as string, pinChosen: !!p.pin_chosen }
}

async function login(req: Request, b: any) {
  const name = clean(b?.name, 40), pin = b?.pin
  const fail = async (personId: number | null) => {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    await svc.from('logbook_login_fails').insert({ person_id: personId, ip_hash: (await sha256hex('lb:' + ip)).slice(0, 32) })
    await new Promise(r => setTimeout(r, 400))
    return { ok: false }
  }
  const p = must(await svc.from('logbook_people').select('id').eq('name', name).eq('active', true).maybeSingle()) as any
  if (!p) return fail(null)
  // 5 wrong PINs in 15 minutes lock that name for 15 minutes
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await svc.from('logbook_login_fails').select('id', { count: 'exact', head: true }).eq('person_id', p.id).gte('at', since)
  if ((count ?? 0) >= 5) return { ok: false, locked: true }
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return fail(p.id)
  const id = must(await svc.rpc('logbook_check_pin', { p_name: name, p_pin: pin })) as number | null
  if (!id) return fail(p.id)
  const tok = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, '0')).join('')
  must(await svc.from('logbook_sessions').insert({ person_id: id, token_hash: await sha256hex(tok), expires_at: new Date(Date.now() + 180 * 86400_000).toISOString() }))
  const pc = must(await svc.from('logbook_people').select('pin_chosen').eq('id', id).maybeSingle()) as any
  return { ok: true, token: tok, name, choosePin: !pc?.pin_chosen }
}

async function state() {
  const topics = must(await svc.from('logbook_topics').select('id,name,hint,has_amount,sort,created_at').order('sort').order('created_at')) as any[]
  const people = must(await svc.from('logbook_people').select('id,name')) as any[]
  const pn = Object.fromEntries(people.map(p => [p.id, p.name]))
  const entries = must(await svc.from('logbook_entries').select('id,topic_id,person_id,body,amount,photo_path,created_at').order('created_at', { ascending: false }).limit(1500)) as any[]
  const ids = entries.map(e => e.id)
  const comments = ids.length ? must(await svc.from('logbook_comments').select('id,entry_id,person_id,body,created_at').in('entry_id', ids).order('created_at')) as any[] : []
  const paths = entries.filter(e => e.photo_path).map(e => e.photo_path)
  const urls: Record<string, string> = {}
  if (paths.length) {
    const r = must(await svc.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600)) as any[]
    r.forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl })
  }
  return {
    topics: topics.map(t => ({ id: t.id, name: t.name, hint: t.hint || '', amount: t.has_amount })),
    entries: entries.map(e => ({
      id: e.id, topic: e.topic_id, who: pn[e.person_id] || '?', txt: e.body, amount: e.amount === null ? null : Number(e.amount), at: e.created_at,
      photo: e.photo_path ? urls[e.photo_path] || null : null,
      comments: comments.filter(c => c.entry_id === e.id).map(c => ({ id: c.id, who: pn[c.person_id] || '?', txt: c.body, at: c.created_at })),
    })),
  }
}

async function addEntry(u: { id: number }, b: any) {
  const topic = clean(b?.topic, 40), body = clean(b?.text, 4000)
  if (!body) throw new HttpError(400, 'empty')
  const t = must(await svc.from('logbook_topics').select('id,has_amount').eq('id', topic).maybeSingle()) as any
  if (!t) throw new HttpError(400, 'topic')
  let amount: number | null = null
  if (t.has_amount && b?.amount !== null && b?.amount !== undefined && b?.amount !== '') {
    amount = Math.round(Number(b.amount) * 100) / 100
    if (!isFinite(amount) || amount < 0 || amount > 99999999) throw new HttpError(400, 'amount')
  }
  let photo_path: string | null = null
  if (typeof b?.photo === 'string' && b.photo.startsWith('data:image/jpeg;base64,')) {
    const bin = Uint8Array.from(atob(b.photo.slice(23)), c => c.charCodeAt(0))
    if (bin.length > 3_000_000) throw new HttpError(400, 'photo_too_big')
    photo_path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`
    const up = await svc.storage.from(BUCKET).upload(photo_path, bin, { contentType: 'image/jpeg' })
    if (up.error) throw up.error
  }
  must(await svc.from('logbook_entries').insert({ topic_id: topic, person_id: u.id, body, amount, photo_path }))
  return { ok: true }
}
async function addComment(u: { id: number }, b: any) {
  const body = clean(b?.text, 2000), entry = clean(b?.entry, 40)
  if (!body) throw new HttpError(400, 'empty')
  if (!/^[0-9a-f-]{36}$/.test(entry)) throw new HttpError(400, 'entry')
  must(await svc.from('logbook_comments').insert({ entry_id: entry, person_id: u.id, body }))
  return { ok: true }
}
// a PIN anyone could guess is refused: same digit 4 times, straight runs up or down
function weakPin(p: string) {
  if (/^(\d)\1{3}$/.test(p)) return true
  const d = p.split('').map(Number)
  const step = d[1] - d[0]
  return (step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)
}
async function setPin(u: { id: number; name: string }, b: any) {
  const cur = b?.current, neu = b?.pin
  if (typeof neu !== 'string' || !/^\d{4}$/.test(neu)) throw new HttpError(400, 'pin_format')
  if (weakPin(neu)) throw new HttpError(400, 'pin_weak')
  if (typeof cur !== 'string' || !/^\d{4}$/.test(cur)) throw new HttpError(400, 'pin_current')
  // wrong current PINs count toward the same 5-in-15-minutes lock as sign-in
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count } = await svc.from('logbook_login_fails').select('id', { count: 'exact', head: true }).eq('person_id', u.id).gte('at', since)
  if ((count ?? 0) >= 5) throw new HttpError(429, 'locked')
  const id = must(await svc.rpc('logbook_check_pin', { p_name: u.name, p_pin: cur })) as number | null
  if (id !== u.id) { await svc.from('logbook_login_fails').insert({ person_id: u.id, ip_hash: 'set_pin' }); throw new HttpError(400, 'pin_current') }
  if (cur === neu) throw new HttpError(400, 'pin_same')
  must(await svc.rpc('logbook_set_pin', { p_id: u.id, p_pin: neu }))
  return { ok: true }
}
async function addTopic(u: { id: number }, b: any) {
  const name = clean(b?.name, 40)
  if (!name) throw new HttpError(400, 'empty')
  const id = 't' + crypto.randomUUID().slice(0, 8)
  must(await svc.from('logbook_topics').insert({ id, name, created_by: u.id, sort: 1000 }))
  return { ok: true, id }
}

Deno.serve(async req => {
  const H = cors(req.headers.get('origin') || '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: H })
  try {
    const b = await req.json().catch(() => ({}))
    let out: unknown
    if (b.op === 'people') out = { build: BUILD, people: (must(await svc.from('logbook_people').select('name').eq('active', true).order('id')) as any[]).map(p => p.name) }
    else if (b.op === 'login') out = await login(req, b)
    else {
      const u = await auth(req)
      switch (b.op) {
        case 'state': out = { me: u.name, choosePin: !u.pinChosen, ...(await state()) }; break
        case 'set_pin': out = await setPin(u, b); break
        case 'add_entry': out = await addEntry(u, b); break
        case 'add_comment': out = await addComment(u, b); break
        case 'add_topic': out = await addTopic(u, b); break
        case 'logout': await svc.from('logbook_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', u.session); out = { ok: true }; break
        default: throw new HttpError(400, 'op')
      }
    }
    return new Response(JSON.stringify(out), { headers: H })
  } catch (e) {
    const st = e instanceof HttpError ? e.status : 500
    const code = e instanceof HttpError ? e.code : 'server'
    if (st === 500) console.error(e)
    return new Response(JSON.stringify({ error: code }), { status: st, headers: H })
  }
})
