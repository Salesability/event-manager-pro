-- Backfill `contacts.user_id` when a new auth.users row's email matches an
-- existing `contact_identifiers` row of kind='email'. Lets a customer/portal
-- self-signup find their pre-existing contact record without an admin manually
-- linking it. For 0018 v1, signups are disabled — this is insurance for the
-- day a portal opens. See docs/chunks/0018-user-system/plan.md Phase 3.
--
-- Idempotent: re-running drops + recreates the trigger and replaces the
-- function. Safe to apply repeatedly. Drizzle doesn't model triggers, so this
-- is a hand-written .sql migration in the standard `./drizzle/` sequence.

CREATE OR REPLACE FUNCTION public.contact_user_id_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  matched_contact_id bigint;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ci.contact_id INTO matched_contact_id
  FROM public.contact_identifiers ci
  JOIN public.contacts c ON c.id = ci.contact_id
  WHERE ci.kind = 'email'
    AND lower(ci.value) = lower(NEW.email)
    AND ci.archived_at IS NULL
    AND c.archived_at IS NULL
    AND c.user_id IS NULL
  ORDER BY ci.is_primary DESC, ci.id ASC
  LIMIT 1;

  IF matched_contact_id IS NOT NULL THEN
    UPDATE public.contacts
    SET user_id = NEW.id
    WHERE id = matched_contact_id
      AND user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contact_user_id_backfill_trigger ON auth.users;
--> statement-breakpoint
CREATE TRIGGER contact_user_id_backfill_trigger
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.contact_user_id_backfill();
