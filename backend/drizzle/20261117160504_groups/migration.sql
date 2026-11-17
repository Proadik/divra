CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" varchar(32) NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	CONSTRAINT "group_members_name_ck" CHECK (length(btrim("display_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(40) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_kind_ck" CHECK ("kind" in ('trip', 'home', 'food', 'other')),
	CONSTRAINT "groups_name_ck" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_uq" ON "group_members" ("group_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_name_uq" ON "group_members" ("group_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" ("user_id");--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_added_by_users_id_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;