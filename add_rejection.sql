ALTER TABLE egg_production ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE mortality_records ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;