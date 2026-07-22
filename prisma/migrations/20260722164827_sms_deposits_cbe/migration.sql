-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "cbeBirrPhone" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "payMethod" TEXT,
ADD COLUMN     "smsText" TEXT;
