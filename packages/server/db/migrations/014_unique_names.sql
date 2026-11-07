-- Unit names and template names are unique ignoring case. Until now only the code said so (a "does it exist?" check
-- before the insert), so two requests at the same moment could both pass it and leave two rows. These indexes make the
-- database the one that says no. They are on lower(name), the same expression the code compares, so what the code
-- refuses and what the database refuses are the same set.
--
-- Already-existing duplicates would make the index fail and stop the deploy half-way, so they are renamed first:
-- every row after the first (by id) of a group that matches ignoring case gets its short id added, "Unit 1 (3fa8c2d1)".
-- Nothing is deleted and no id changes, so orders, stages and templates still point at the same rows. A database
-- the API built has none (the check refused them), so this normally changes nothing.
--
-- Row-level security is forced for the table owner too, so the renaming acts as the system role. set_config(..., true)
-- lasts to the end of the transaction, and it is put back at the end of the block.
--
-- Roles and grants are unchanged: an index needs none, and the app role neither creates nor drops one.
do $$
begin
  perform set_config('app.role', 'system', true);

  update unit u set name = u.name || ' (' || left(u.id::text, 8) || ')'
    from (select id, row_number() over (partition by lower(name) order by id) as n from unit) d
   where d.id = u.id and d.n > 1;

  update tna_template t set name = t.name || ' (' || left(t.id::text, 8) || ')'
    from (select id, row_number() over (partition by lower(name) order by id) as n from tna_template) d
   where d.id = t.id and d.n > 1;

  perform set_config('app.role', '', true);
end $$;

create unique index unit_name_lower_key on unit (lower(name));
create unique index tna_template_name_lower_key on tna_template (lower(name));
