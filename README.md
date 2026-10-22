# Zeno's Logbook (B-60)

Shared daily logbook for Zeno's on the Square: one tab per topic, entries with photo and amount, comments.

- `web/` — the app (static PWA on GitHub Pages). Talks only to the edge function `zenos-logbook-api`. Ships **no** Supabase key.
- `supabase/functions/zenos-logbook-api/` — server: name + 4-digit PIN login (bcrypt in the database), sessions, reads/writes.
- `supabase/migrations/` — isolated `logbook_*` tables + private bucket `logbook-photos` in the Brigade project. Rollback in the file header.

Nothing else in Brigade is read or written. PINs are never stored in this repo.
