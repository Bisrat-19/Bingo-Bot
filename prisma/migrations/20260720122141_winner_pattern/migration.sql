-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "winnerLine" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "winnerPattern" TEXT;
