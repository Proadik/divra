CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"display_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"chain" varchar(16) NOT NULL,
	"address" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_accounts_chain_ck" CHECK ("chain" in ('solana', 'ethereum', 'ton', 'tron'))
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"chain" varchar(16) NOT NULL,
	"address" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"message_hash" varchar(64) NOT NULL,
	"blockhash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_token_family_revocations" (
	"family_id" varchar(128) PRIMARY KEY,
	"revoked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" varchar(128) PRIMARY KEY,
	"family_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"claims" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_accounts_chain_address_uq" ON "wallet_accounts" ("chain","address");--> statement-breakpoint
CREATE INDEX "wallet_accounts_user_idx" ON "wallet_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_challenges_address_idx" ON "auth_challenges" ("chain","address");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_idx" ON "auth_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_token_family_revocations_at_idx" ON "refresh_token_family_revocations" ("revoked_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_expires_idx" ON "refresh_tokens" ("family_expires_at");--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;