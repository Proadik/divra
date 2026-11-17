CREATE TABLE "settlement_transfers" (
	"settlement_id" uuid,
	"group_id" uuid NOT NULL,
	"member_id" uuid,
	"address" varchar(44) NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "settlement_transfers_pkey" PRIMARY KEY("settlement_id","member_id"),
	CONSTRAINT "settlement_transfers_amount_ck" CHECK ("amount_cents" > 0 and "amount_cents" <= 100000000)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"payer_member_id" uuid NOT NULL,
	"created_by" uuid,
	"payer_address" varchar(44) NOT NULL,
	"token" varchar(4) NOT NULL,
	"mint" varchar(44) NOT NULL,
	"reference" varchar(44) NOT NULL,
	"status" varchar(10) DEFAULT 'prepared' NOT NULL,
	"signature" varchar(88),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "settlements_status_ck" CHECK ("status" in ('prepared', 'submitted', 'confirmed', 'failed')),
	CONSTRAINT "settlements_token_ck" CHECK ("token" in ('USDC', 'USDT'))
);
--> statement-breakpoint
DROP INDEX "payments_signature_uq";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "settlement_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_signature_to_uq" ON "payments" ("signature","to_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_reference_uq" ON "settlements" ("reference");--> statement-breakpoint
CREATE INDEX "settlements_submitted_idx" ON "settlements" ("submitted_at") WHERE "status" = 'submitted';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlement_id_settlements_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_settlement_id_settlements_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_member_fk" FOREIGN KEY ("group_id","member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_fk" FOREIGN KEY ("group_id","payer_member_id") REFERENCES "group_members"("group_id","id");