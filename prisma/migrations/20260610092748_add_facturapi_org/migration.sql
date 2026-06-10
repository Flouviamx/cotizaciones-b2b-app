-- CreateTable
CREATE TABLE "FacturapiOrg" (
    "shop" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "liveKeyEnc" TEXT,
    "testKey" TEXT,
    "rfc" TEXT,
    "legalName" TEXT,
    "certUploaded" BOOLEAN NOT NULL DEFAULT false,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacturapiOrg_pkey" PRIMARY KEY ("shop")
);
