-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "instructionsText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "supportItems" JSONB NOT NULL DEFAULT '[]';
