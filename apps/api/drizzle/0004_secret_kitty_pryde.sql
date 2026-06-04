CREATE TABLE "vault_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"source_platform" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"ciphertext" text NOT NULL,
	"salt" text,
	"linked_conversation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_conversations" ADD CONSTRAINT "vault_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_conversations" ADD CONSTRAINT "vault_conversations_linked_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("linked_conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;