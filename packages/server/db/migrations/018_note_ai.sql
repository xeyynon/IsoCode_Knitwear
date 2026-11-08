-- An AI suggestion for each note from the floor: an English meaning and a reason from the fixed list, with how sure the
-- model said it was. Kept in columns of its own, beside the supervisor's original words (text_ta / text_en) and the
-- merchandiser's final choice (category, category_by), so nothing the model says ever replaces what a person wrote or decided.
-- The existing column `confidence` (001) holds the model's own confidence, 0 to 1.
--
--   ai_status  suggested  the model answered with a reason on the list, at or above ai_min_confidence
--              unsure     it answered, but below the threshold or with a reason not on the list: a person must decide
--              failed     no usable answer (timeout, refusal, malformed reply, service down); tried again up to 3 times
--   null       not asked yet (or AI is switched off on this server)
alter table note add column ai_status text check (ai_status in ('suggested', 'unsure', 'failed'));
alter table note add column ai_text_en text check (ai_text_en is null or length(ai_text_en) <= 1000);
alter table note add column ai_category text;
alter table note add column ai_why text check (ai_why is null or length(ai_why) <= 500);
alter table note add column ai_model text;
alter table note add column ai_error text;
alter table note add column ai_attempts int not null default 0 check (ai_attempts >= 0);
alter table note add column ai_at timestamptz;

-- Below this the suggestion is shown as "not sure" and the reason is not pre-selected for the merchandiser.
do $$ begin
perform set_config('app.role', 'system', true);
insert into settings (key, value) values ('ai_min_confidence', '0.7');
end $$;
