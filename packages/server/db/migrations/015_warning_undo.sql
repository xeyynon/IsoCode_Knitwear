-- "Don't show" on a warning can be undone only if the warning was still waiting for review when it was hidden.
-- A confirmed warning that is hidden had been shown to a buyer, so showing it again needs a fresh confirmation, never an undo.
-- Dismissing clears the confirmation, so the state it had must be kept here. NULL while the warning is not dismissed.
-- Rows hidden before this migration have no recorded state; they count as "was confirmed", which means no undo (the safe side).
alter table warning add column dismissed_was_confirmed boolean;
update warning set dismissed_was_confirmed = true where dismissed_at is not null;
