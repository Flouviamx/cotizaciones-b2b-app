import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PLAN_PLUS_MENSUAL,
  PLAN_PLUS_ANUAL,
  PRECIO_BASICO_MENSUAL,
  PRECIO_BASICO_ANUAL,
  PRECIO_PRO_MENSUAL,
  PRECIO_PRO_ANUAL,
  PRECIO_PLUS_MENSUAL,
  PRECIO_PLUS_ANUAL,
  CFDI_LIMITE_PRO,
  CFDI_LIMITE_PLUS,
  CFDI_EXTRA_PRO,
  CFDI_EXTRA_PLUS,
  CFDI_CAP_PRO_MENSUAL,
  CFDI_CAP_PRO_ANUAL,
  CFDI_CAP_PLUS_MENSUAL,
  CFDI_CAP_PLUS_ANUAL,
} from "./plans";

// Re-exportamos para que otras rutas de servidor las importen de aquí.
export {
  PLAN_BASICO_MENSUAL,
  PLAN_BASICO_ANUAL,
  PLAN_PRO_MENSUAL,
  PLAN_PRO_ANUAL,
  PLAN_PLUS_MENSUAL,
  PLAN_PLUS_ANUAL,
};

// Texto de los términos de la línea de uso (excedente CFDI), mostrado al
// comerciante en la pantalla de aprobación de Shopify.
const terminosExtra = (extra: number, incluidas: number) =>
  `$${extra.toFixed(2)} USD por cada CFDI adicional después de ${incluidas} facturas/mes incluidas.`;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [PLAN_BASICO_MENSUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_BASICO_MENSUAL,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PLAN_BASICO_ANUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_BASICO_ANUAL,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    // Pro y Plus: línea recurrente fija + línea de uso (excedente CFDI).
    // El timbrado de facturas por encima de la cuota mensual crea "usage
    // charges" contra esta línea (ver app/cfdi-usage.server.ts).
    [PLAN_PRO_MENSUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_PRO_MENSUAL,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
        {
          amount: CFDI_CAP_PRO_MENSUAL,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: terminosExtra(CFDI_EXTRA_PRO, CFDI_LIMITE_PRO),
        },
      ],
    },
    [PLAN_PRO_ANUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_PRO_ANUAL,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
        {
          amount: CFDI_CAP_PRO_ANUAL,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: terminosExtra(CFDI_EXTRA_PRO, CFDI_LIMITE_PRO),
        },
      ],
    },
    [PLAN_PLUS_MENSUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_PLUS_MENSUAL,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
        {
          amount: CFDI_CAP_PLUS_MENSUAL,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: terminosExtra(CFDI_EXTRA_PLUS, CFDI_LIMITE_PLUS),
        },
      ],
    },
    [PLAN_PLUS_ANUAL]: {
      trialDays: 7,
      lineItems: [
        {
          amount: PRECIO_PLUS_ANUAL,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
        {
          amount: CFDI_CAP_PLUS_ANUAL,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: terminosExtra(CFDI_EXTRA_PLUS, CFDI_LIMITE_PLUS),
        },
      ],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
