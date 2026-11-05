ALTER TABLE "users" ADD COLUMN "googleSub" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "appleSub" VARCHAR(255);
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
CREATE UNIQUE INDEX "users_appleSub_key" ON "users"("appleSub");
