CREATE TABLE "chain_stream_state" (
	"name" varchar(32) PRIMARY KEY,
	"last_slot" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detected_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"signature" varchar(88) NOT NULL,
	"slot" bigint NOT NULL,
	"token" varchar(4) NOT NULL,
	"mint" varchar(44) NOT NULL,
	"raw_amount" bigint NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"from_address" varchar(44) NOT NULL,
	"to_address" varchar(44) NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "detected_transfers_status_ck" CHECK ("status" in ('pending', 'applied', 'dismissed')),
	CONSTRAINT "detected_transfers_amount_ck" CHECK ("raw_amount" > 0),
	CONSTRAINT "detected_transfers_users_ck" CHECK ("from_user_id" <> "to_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "detect_transfers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "detected_transfers_signature_to_uq" ON "detected_transfers" ("signature","to_address");--> statement-breakpoint
CREATE INDEX "detected_transfers_to_pending_idx" ON "detected_transfers" ("to_user_id","created_at") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "detected_transfers" ADD CONSTRAINT "detected_transfers_from_user_id_users_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "detected_transfers" ADD CONSTRAINT "detected_transfers_to_user_id_users_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "detected_transfers" ADD CONSTRAINT "detected_transfers_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL;