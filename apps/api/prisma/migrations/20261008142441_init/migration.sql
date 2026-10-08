-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'banned', 'dismissed');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('user', 'admin', 'system');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "premiumUntil" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "signupRef" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pass_claims" (
    "sessionId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pass_claims_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "bans" (
    "visitor" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bans_pkey" PRIMARY KEY ("visitor")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reporter" TEXT NOT NULL,
    "reported" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "transcript" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "EventKind" NOT NULL,
    "type" TEXT NOT NULL,
    "visitor" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hourly_stats" (
    "hour" TIMESTAMP(3) NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "chats" INTEGER NOT NULL DEFAULT 0,
    "videoChats" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "reports" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "passes" INTEGER NOT NULL DEFAULT 0,
    "bans" INTEGER NOT NULL DEFAULT 0,
    "chatsEnded" INTEGER NOT NULL DEFAULT 0,
    "chatSeconds" INTEGER NOT NULL DEFAULT 0,
    "peakOnline" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hourly_stats_pkey" PRIMARY KEY ("hour")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "pass_claims_userId_idx" ON "pass_claims"("userId");

-- CreateIndex
CREATE INDEX "bans_until_idx" ON "bans"("until");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_reported_createdAt_idx" ON "reports"("reported", "createdAt");

-- CreateIndex
CREATE INDEX "events_at_idx" ON "events"("at");

-- CreateIndex
CREATE INDEX "events_kind_at_idx" ON "events"("kind", "at");

-- AddForeignKey
ALTER TABLE "pass_claims" ADD CONSTRAINT "pass_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
