-- Real email (Resend SMTP) is live, so new accounts must confirm their email.
drop trigger if exists autoconfirm_before_insert on auth.users;
-- Rollback (only if email sending breaks):
-- create trigger autoconfirm_before_insert before insert on auth.users for each row execute function public.autoconfirm_user();
