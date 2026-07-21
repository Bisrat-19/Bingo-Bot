-- CreateTable
CREATE TABLE "receipt_files" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_files_txId_key" ON "receipt_files"("txId");

-- AddForeignKey
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_txId_fkey" FOREIGN KEY ("txId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
