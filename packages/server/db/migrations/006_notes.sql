-- Notes on an update: why a stage is slow, in the supervisor's own words, and a reason from a fixed list.
-- A merchandiser reviews them (adds the English meaning, confirms the reason). Notes are internal:
-- there is deliberately NO policy letting a buyer read them.
alter table note add column stage text;
alter table note add column unit_id uuid references unit(id);
alter table note add column taken_on date;
alter table note add column language text check (language in ('ta', 'en'));   -- of the original text
alter table note add column category_by text check (category_by in ('supervisor', 'merchandiser'));
alter table note add column created_at timestamptz not null default now();
alter table note add column confirmed_at timestamptz;

-- A supervisor can read back the note they just wrote (INSERT ... RETURNING), for their own unit.
create policy sup_note_read on note for select using (app_role() = 'supervisor' and unit_id = app_unit());

-- The reason list is read by everyone signed in (the phone needs it to show the choices), and only that one setting.
create policy reasons_read on settings for select using (
  key = 'reason_categories' and app_role() in ('supervisor', 'merchandiser', 'system'));

-- The fixed list of reasons. The client edits it in week 1. The Tamil wording is UNREVIEWED: supervisors must correct it.
-- FORCE RLS binds the table owner too, so the insert acts as 'system'. One DO block keeps the
-- transaction-local setting and the insert together, whether psql runs in autocommit or with -1.
do $$ begin
perform set_config('app.role', 'system', true);
insert into settings (key, value) values ('reason_categories', '[
  {"id": "labour",   "en": "Not enough workers",   "ta": "ஆட்கள் பற்றாக்குறை"},
  {"id": "absence",  "en": "Workers on leave",     "ta": "ஊழியர் விடுப்பு"},
  {"id": "machine",  "en": "Machine problem",      "ta": "இயந்திரம் பழுது"},
  {"id": "material", "en": "Material is late",     "ta": "பொருள் தாமதம்"},
  {"id": "power",    "en": "No power",             "ta": "மின்சாரம் இல்லை"},
  {"id": "quality",  "en": "Fixing quality",       "ta": "தரம் சரிசெய்தல்"},
  {"id": "other",    "en": "Something else",       "ta": "மற்றவை"}
]'::jsonb);
end $$;
