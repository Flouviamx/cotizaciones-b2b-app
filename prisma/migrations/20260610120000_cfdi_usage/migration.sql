-- CreateTable
CREATE TABLE "CfdiUsage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "timbrados" INTEGER NOT NULL DEFAULT 0,
    "extraCobrado" INTEGER NOT NULL DEFAULT 0,
    "aviso80" BOOLEAN NOT NULL DEFAULT false,
    "aviso100" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfdiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CfdiUsage_shop_periodo_key" ON "CfdiUsage"("shop", "periodo");
