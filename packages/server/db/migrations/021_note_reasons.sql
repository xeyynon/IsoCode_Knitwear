-- Several reasons on one note, and a note that was written from them.
--
-- The production update form now lets a supervisor tap more than one reason ("Machine problem" and "Not enough workers") and writes the
-- note from them. Until now a note had one `category`.
--
--   note.categories  the reasons in the order they were tapped (ids from the settings list `reason_categories`), at most seven. The
--                    first one is the MAIN reason and stays in `category`, so the review queue, the AI suggestion and every query
--                    written before this migration keep working unchanged. Empty = no reason chosen.
--   note.generated   true when the note's text is exactly the sentence the app writes from `categories` (packages/engine reasonNote.ts).
--                    The SERVER sets it, never the phone: it compares the text with that sentence. Such a note needs no AI call.
--
-- Rows from before this migration get a one-item list from their `category`.
--
-- The table's insert policy for supervisors (016) is widened by exactly one case: a supervisor may write a "generated" note, whose
-- AI-suggestion columns then hold the supervisor's own choice (model 'supervisor-choice', confidence 1, the main reason). Any other
-- use of `generated` or of the suggestion columns by a supervisor session is still refused, as is confirming a note or saying a
-- merchandiser chose the reason (016). The sentence itself cannot be checked in SQL; the server checks it before it writes.
--
-- Row-level security is forced for the table owner too, so the data step acts as the system role (as 014, 016 and 020 do);
-- set_config(..., true) lasts to the end of the transaction and is put back at the end of the block.
alter table note add column categories text[] not null default '{}';
alter table note add column generated boolean not null default false;

do $$ begin
perform set_config('app.role', 'system', true);
update note set categories = array[category] where category is not null and categories = '{}';
perform set_config('app.role', '', true);
end $$;

-- The main reason is the first of the list; and a note cannot carry more reasons than the list has.
alter table note add constraint note_categories_ok check (
  cardinality(categories) <= 7 and (cardinality(categories) = 0 or (category is not null and categories[1] = category))
);

drop policy if exists sup_note_write on note;
create policy sup_note_write on note for insert with check (
  app_role() = 'supervisor'
  and confirmed_by is null and confirmed_at is null and category_by is distinct from 'merchandiser'
  and (
    (generated = false and ai_status is null)
    or (generated and ai_status = 'suggested' and ai_model = 'supervisor-choice' and confidence = 1
        and category is not null and ai_category = category and ai_attempts = 0)
  )
  and exists (select 1 from milestone m
    where m.order_id = note.order_id and m.stage = note.stage and m.unit_id = app_unit()
      and m.unit_id = note.unit_id and m.buyer_id = note.buyer_id));
