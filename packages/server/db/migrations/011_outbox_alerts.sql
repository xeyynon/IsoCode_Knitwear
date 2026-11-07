-- The outbox holds MOCKED alerts: a record of what would be emailed or sent on WhatsApp. Nothing is
-- sent anywhere. 001 made the table and its policy (staff only; buyers and supervisors have none, so
-- FORCE ROW LEVEL SECURITY leaves them no rows). This adds what a reader needs: who the alert is for,
-- a subject, and the order it is about. recipient stays a label (a buyer's name, or "Merchandisers"),
-- never a real address.
alter table outbox add column recipient_kind text not null default 'merchandiser' check (recipient_kind in ('buyer', 'merchandiser'));
alter table outbox add column subject text not null default '';
alter table outbox add column order_id uuid references orders(id);
alter table outbox alter column recipient_kind drop default;
alter table outbox alter column subject drop default;
alter table outbox add constraint outbox_channel_known check (channel in ('email', 'whatsapp'));
create index outbox_newest on outbox (created_at desc, id);

-- A record of what was said: it is added to, never rewritten or deleted by the API.
revoke update, delete on outbox from app_user;
