-- 03 (24/10, Max: "non posso modificare un mio inserimento"): an entry edited by its author shows "edited".
alter table public.logbook_entries add column if not exists edited_at timestamptz;
-- ROLLBACK: alter table public.logbook_entries drop column if exists edited_at;
