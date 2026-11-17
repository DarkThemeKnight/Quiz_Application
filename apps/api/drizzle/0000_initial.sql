CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."item_state" AS ENUM('unanswered', 'answered', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('single_choice', 'multi_choice', 'true_false', 'fill_gap');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('unreviewed', 'verified', 'needs_update');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('practice', 'exam');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'submitted', 'abandoned');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection_questions" (
	"collection_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_questions_collection_id_question_id_pk" PRIMARY KEY("collection_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_blanks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"accepted_answers" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"body" text NOT NULL,
	"is_correct" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_tags" (
	"question_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "question_tags_question_id_tag_id_pk" PRIMARY KEY("question_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"topic_id" uuid,
	"kind" "question_kind" NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"status" "question_status" DEFAULT 'published' NOT NULL,
	"review_status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"body" text NOT NULL,
	"fingerprint" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"source_label" text DEFAULT '' NOT NULL,
	"verified_at" date,
	"external_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_revision_positive" CHECK ("questions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "review_schedule" (
	"question_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"box" integer DEFAULT 1 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"latest_outcome" boolean NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "review_schedule_box_range" CHECK ("review_schedule"."box" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid,
	"position" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"state" "item_state" DEFAULT 'unanswered' NOT NULL,
	"answer" jsonb,
	"grade" jsonb,
	"is_correct" boolean,
	"marked_for_review" boolean DEFAULT false NOT NULL,
	"time_spent_ms" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone,
	"graded_at" timestamp with time zone,
	"locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "session_items_time_nonnegative" CHECK ("session_items"."time_spent_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"mode" "session_mode" NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"title" text NOT NULL,
	"selection_config" jsonb NOT NULL,
	"question_count" integer NOT NULL,
	"allow_skip" boolean DEFAULT true NOT NULL,
	"time_limit_seconds" integer,
	"current_position" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submit_reason" text,
	"score_correct" integer,
	"score_total" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_sessions_count_positive" CHECK ("study_sessions"."question_count" > 0),
	CONSTRAINT "study_sessions_time_limit_positive" CHECK ("study_sessions"."time_limit_seconds" is null or "study_sessions"."time_limit_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"parent_topic_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_not_own_parent" CHECK ("topics"."parent_topic_id" is null or "topics"."parent_topic_id" <> "topics"."id")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_questions" ADD CONSTRAINT "collection_questions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_questions" ADD CONSTRAINT "collection_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_blanks" ADD CONSTRAINT "question_blanks_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_tags" ADD CONSTRAINT "question_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedule" ADD CONSTRAINT "review_schedule_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedule" ADD CONSTRAINT "review_schedule_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_items" ADD CONSTRAINT "session_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_topic_id_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_owner_idx" ON "auth_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "collection_questions_question_idx" ON "collection_questions" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_name_key" ON "collections" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "owners_username_key" ON "owners" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "owners_singleton" ON "owners" USING btree ((true));--> statement-breakpoint
CREATE UNIQUE INDEX "question_blanks_key" ON "question_blanks" USING btree ("question_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "question_options_position_key" ON "question_options" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "question_tags_tag_idx" ON "question_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "questions_subject_idx" ON "questions" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "questions_fingerprint_idx" ON "questions" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_external_id_key" ON "questions" USING btree ("external_id") WHERE "questions"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "review_schedule_due_idx" ON "review_schedule" USING btree ("next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_items_position_key" ON "session_items" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "session_items_question_idx" ON "session_items" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "session_items_graded_idx" ON "session_items" USING btree ("graded_at");--> statement-breakpoint
CREATE INDEX "study_sessions_owner_status_idx" ON "study_sessions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "study_sessions_submitted_idx" ON "study_sessions" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_name_key" ON "subjects" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_key" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "topics_sibling_name_key" ON "topics" USING btree ("subject_id",coalesce("parent_topic_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "topics_subject_idx" ON "topics" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "topics_parent_idx" ON "topics" USING btree ("parent_topic_id");