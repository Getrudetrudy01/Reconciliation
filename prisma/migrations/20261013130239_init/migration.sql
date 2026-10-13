-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'GTBANK',
    "ledgerFileName" TEXT NOT NULL,
    "bankFileName" TEXT NOT NULL,
    "statementPeriod" TEXT,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "tolerance" DOUBLE PRECISION NOT NULL,
    "totalLedgerRows" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "mismatchedCount" INTEGER NOT NULL,
    "flaggedCount" INTEGER NOT NULL,
    "runBy" TEXT,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "date" TEXT,
    "walletTransactionId" TEXT,
    "transactionId" TEXT,
    "customerName" TEXT,
    "ledgerAmount" DOUBLE PRECISION,
    "bankDebit" DOUBLE PRECISION,
    "diff" DOUBLE PRECISION,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolutionNote" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.50,
    "tolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.02,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationRow_runId_idx" ON "ReconciliationRow"("runId");

-- CreateIndex
CREATE INDEX "ReconciliationRow_transactionId_idx" ON "ReconciliationRow"("transactionId");

-- AddForeignKey
ALTER TABLE "ReconciliationRow" ADD CONSTRAINT "ReconciliationRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
