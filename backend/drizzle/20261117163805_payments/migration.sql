CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" varchar(32) NOT NULL,
	"group_id" uuid NOT NULL,
	"requester_member_id" uuid NOT NULL,
	"debtor_member_id" uuid NOT NULL,
	"created_by" uuid,
	"recipient" varchar(44) NOT NULL,
	"token" varchar(4) NOT NULL,
	"mint" varchar(44) NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" varchar(44) NOT NULL,
	"message" varchar(140) DEFAULT '' NOT NULL,
	"remind_in_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_requests_amount_ck" CHECK ("amount_cents" > 0 and "amount_cents" <= 100000000),
	CONSTRAINT "payment_requests_token_ck" CHECK ("token" in ('USDC', 'USDT')),
	CONSTRAINT "payment_requests_remind_ck" CHECK ("remind_in_days" is null or "remind_in_days" between 1 and 60),
	CONSTRAINT "payment_requests_debtor_ck" CHECK ("requester_member_id" <> "debtor_member_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"token" varchar(4) NOT NULL,
	"signature" varchar(88) NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("amount_cents" > 0),
	CONSTRAINT "payments_token_ck" CHECK ("token" in ('USDC', 'USDT')),
	CONSTRAINT "payments_members_ck" CHECK ("from_member_id" <> "to_member_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_code_uq" ON "payment_requests" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_reference_uq" ON "payment_requests" ("reference");--> statement-breakpoint
CREATE INDEX "payment_requests_open_idx" ON "payment_requests" ("last_checked_at") WHERE "paid_at" is null;--> statement-breakpoint
CREATE INDEX "payment_requests_group_idx" ON "payment_requests" ("group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_signature_uq" ON "payments" ("signature");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_request_uq" ON "payments" ("request_id") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_group_idx" ON "payments" ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requester_fk" FOREIGN KEY ("group_id","requester_member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_debtor_fk" FOREIGN KEY ("group_id","debtor_member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_request_id_payment_requests_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_from_fk" FOREIGN KEY ("group_id","from_member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_to_fk" FOREIGN KEY ("group_id","to_member_id") REFERENCES "group_members"("group_id","id");