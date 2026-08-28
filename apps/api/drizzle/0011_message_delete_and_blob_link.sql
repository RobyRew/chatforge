ALTER TABLE "blobs" ADD COLUMN "message_seq" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX "blobs_message_idx" ON "blobs" USING btree ("conversation_id","message_seq");