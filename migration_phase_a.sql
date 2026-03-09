-- Phase A SQL migration
-- Run this in your terminal BEFORE deploying Phase A code:
--
--   psql $DATABASE_URL < migration_phase_a.sql
--   npx prisma generate
--
-- Then add `profilePicUrl String? @db.Text` to the User model in schema.prisma
-- (between phone and the next field)

-- 1. Add profilePicUrl column to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profilePicUrl" TEXT;

-- 2. Add @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner to package.json
--    Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
--    (already installed if you used the Phase 5.2 email delivery)

-- Prisma schema.prisma — add this line inside the User model:
--   profilePicUrl  String?   @db.Text
