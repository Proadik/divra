CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" varchar(32) NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid,
	"inviter_member_id" uuid NOT NULL,
	"claim_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invites_code_uq" ON "invites" ("code");--> statement-breakpoint
CREATE INDEX "invites_group_idx" ON "invites" ("group_id");--> statement-breakpoint
CREATE INDEX "invites_claim_idx" ON "invites" ("claim_member_id") WHERE "claim_member_id" is not null;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_fk" FOREIGN KEY ("group_id","inviter_member_id") REFERENCES "group_members"("group_id","id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_claim_fk" FOREIGN KEY ("group_id","claim_member_id") REFERENCES "group_members"("group_id","id");