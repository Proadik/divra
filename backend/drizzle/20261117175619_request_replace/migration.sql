ALTER TABLE "payment_requests" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
-- Уже созданные дубли: из неоплаченных запросов одной пары действующим остаётся самый новый
UPDATE "payment_requests" AS "pr" SET "replaced_at" = now()
WHERE "pr"."paid_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "payment_requests" AS "newer"
    WHERE "newer"."requester_member_id" = "pr"."requester_member_id"
      AND "newer"."debtor_member_id" = "pr"."debtor_member_id"
      AND "newer"."paid_at" IS NULL
      AND ("newer"."created_at", "newer"."id") > ("pr"."created_at", "pr"."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_active_uq" ON "payment_requests" ("requester_member_id","debtor_member_id") WHERE "paid_at" is null and "replaced_at" is null;
