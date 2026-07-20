-- AlterTable
ALTER TABLE "users" ADD COLUMN     "registered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registeredAt" TIMESTAMP(3);
