-- DropIndex
DROP INDEX "entries_roundId_userId_key";

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "maxCardsPerPlayer" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "entries_roundId_userId_idx" ON "entries"("roundId", "userId");
