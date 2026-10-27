CREATE TABLE "chat_contacts" (
	"owner_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"nickname" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_contacts_owner_id_contact_id_pk" PRIMARY KEY("owner_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "chat_contacts" ADD CONSTRAINT "chat_contacts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_contacts" ADD CONSTRAINT "chat_contacts_contact_id_user_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
