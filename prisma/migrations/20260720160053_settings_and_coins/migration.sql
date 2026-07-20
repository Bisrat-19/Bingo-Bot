-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "entryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pot" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "selectionSeconds" INTEGER NOT NULL DEFAULT 30,
    "drawIntervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "winnerDisplaySeconds" INTEGER NOT NULL DEFAULT 8,
    "minPlayers" INTEGER NOT NULL DEFAULT 1,
    "startingCoins" INTEGER NOT NULL DEFAULT 30,
    "entryFee" INTEGER NOT NULL DEFAULT 10,
    "falseBingoCooldownSec" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);
