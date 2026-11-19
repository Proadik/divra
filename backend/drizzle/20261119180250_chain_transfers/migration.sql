CREATE TABLE "chain_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"signature" varchar(88) NOT NULL,
	"slot" bigint NOT NULL,
	"token" varchar(4) NOT NULL,
	"mint" varchar(44) NOT NULL,
	"raw_amount" bigint NOT NULL,
	"from_address" varchar(44) NOT NULL,
	"to_address" varchar(44) NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_transfers_amount_ck" CHECK ("raw_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chain_transfers_signature_to_uq" ON "chain_transfers" ("signature","to_address","mint");--> statement-breakpoint
CREATE INDEX "chain_transfers_from_user_idx" ON "chain_transfers" ("from_user_id","created_at");--> statement-breakpoint
CREATE INDEX "chain_transfers_to_user_idx" ON "chain_transfers" ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "chain_transfers_signature_idx" ON "chain_transfers" ("signature");--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_from_user_id_users_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chain_transfers" ADD CONSTRAINT "chain_transfers_to_user_id_users_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL;