CREATE TABLE "expense_shares" (
	"expense_id" uuid,
	"group_id" uuid NOT NULL,
	"member_id" uuid,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "expense_shares_pkey" PRIMARY KEY("expense_id","member_id"),
	CONSTRAINT "expense_shares_amount_ck" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"title" varchar(60) NOT NULL,
	"category" varchar(16) NOT NULL,
	"paid_by_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"split_mode" varchar(8) NOT NULL,
	"original_currency" varchar(3),
	"original_amount" double precision,
	"original_rate" double precision,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_group_id_uq" UNIQUE("group_id","id"),
	CONSTRAINT "expenses_amount_ck" CHECK ("amount_cents" > 0 and "amount_cents" <= 100000000),
	CONSTRAINT "expenses_category_ck" CHECK ("category" in ('transport', 'housing', 'food', 'groceries', 'fun', 'other')),
	CONSTRAINT "expenses_split_mode_ck" CHECK ("split_mode" in ('equal', 'exact', 'percent', 'shares')),
	CONSTRAINT "expenses_original_ck" CHECK (("original_currency" is null and "original_amount" is null and "original_rate" is null)
        or ("original_currency" in ('KZT', 'RUB', 'CNY', 'EUR', 'USD')
          and "original_amount" > 0 and "original_rate" > 0)),
	CONSTRAINT "expenses_title_ck" CHECK (length(btrim("title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_uq" UNIQUE("group_id","id");--> statement-breakpoint
CREATE INDEX "expense_shares_group_idx" ON "expense_shares" ("group_id");--> statement-breakpoint
CREATE INDEX "expenses_group_created_idx" ON "expenses" ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_fk" FOREIGN KEY ("group_id","expense_id") REFERENCES "expenses"("group_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_member_fk" FOREIGN KEY ("group_id","member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_fk" FOREIGN KEY ("group_id","paid_by_member_id") REFERENCES "group_members"("group_id","id");