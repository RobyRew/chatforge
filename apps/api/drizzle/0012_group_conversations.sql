ALTER TABLE "chat_conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;