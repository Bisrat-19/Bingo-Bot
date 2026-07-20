-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "patterns" TEXT[] DEFAULT ARRAY['HORIZONTAL', 'VERTICAL', 'DIAGONAL']::TEXT[];

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false;
