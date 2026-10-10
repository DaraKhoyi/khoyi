-- Rollback for 2026-10-08e. Run only AFTER google-token-seal {"mode":"unseal"}
-- has reported sealed_remaining = 0, or keep it: the function is harmless.
drop function if exists public.google_token_swap(uuid, text, text, text);
notify pgrst, 'reload schema';
