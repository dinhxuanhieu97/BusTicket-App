-- Keep archived accounts to preserve audit history and foreign keys.
ALTER TABLE users
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT users_archive_requires_disabled_staff
    CHECK (archived_at IS NULL OR (operator_id IS NOT NULL AND status = 'DISABLED'));
