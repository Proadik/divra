ALTER TABLE "group_members" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "last_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" varchar(8) DEFAULT 'onchain' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "signature" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "group_members_group_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_name_uq" ON "group_members" ("group_id",lower("display_name")) WHERE "left_at" is null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_ck" CHECK (("method" = 'onchain' and "signature" is not null and "token" is not null)
        or ("method" = 'cash' and "signature" is null and "token" is null));--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_token_ck", ADD CONSTRAINT "payments_token_ck" CHECK ("token" is null or "token" in ('USDC', 'USDT'));