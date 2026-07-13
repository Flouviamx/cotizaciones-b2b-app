// BORRA TODAS las cotizaciones (draft orders) de flouvia.myshopify.com para
// dejar la app "como recién instalada" antes del screencast. NUNCA imprime secretos.
// Uso: node borrar-cotizaciones.mjs        → solo lista (dry run)
//      node borrar-cotizaciones.mjs --borrar → borra de verdad
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ROOT = "/Users/andrevalleortega/Desktop/flouvia-apps/cotizaciones-b2b-mx";
const BORRAR = process.argv.includes("--borrar");

for (const line of readFileSync(`${ROOT}/.env`, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const require = createRequire(`${ROOT}/package.json`);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const sesion = await prisma.session.findFirst({
  where: { isOnline: false, shop: "flouvia.myshopify.com" },
});
if (!sesion) {
  console.error("No hay sesión offline de flouvia.myshopify.com en la DB.");
  process.exit(1);
}
const { shop, accessToken } = sesion;
const API = `https://${shop}/admin/api/2025-07/graphql.json`;

async function gql(query, variables) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// 1) Listar todas
let after = null;
const all = [];
do {
  const d = await gql(
    `query($after: String) {
      draftOrders(first: 50, after: $after, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges { node { id name status createdAt } }
      }
    }`,
    { after },
  );
  all.push(...d.draftOrders.edges.map((e) => e.node));
  after = d.draftOrders.pageInfo.hasNextPage ? d.draftOrders.pageInfo.endCursor : null;
} while (after);

console.log(`Encontradas: ${all.length} cotizaciones`);
for (const n of all) console.log(`  ${n.name}  ${n.status}  ${n.createdAt.slice(0, 10)}`);

if (!BORRAR) {
  console.log("\n(dry run — corre con --borrar para eliminarlas)");
} else {
  let ok = 0, fail = 0;
  for (const n of all) {
    try {
      const d = await gql(
        `mutation($input: DraftOrderDeleteInput!) {
          draftOrderDelete(input: $input) { deletedId userErrors { field message } }
        }`,
        { input: { id: n.id } },
      );
      const errs = d.draftOrderDelete.userErrors ?? [];
      if (errs.length) { fail++; console.log(`  ✗ ${n.name}: ${errs.map((e) => e.message).join(", ")}`); }
      else { ok++; console.log(`  ✓ ${n.name} borrada`); }
    } catch (e) {
      fail++; console.log(`  ✗ ${n.name}: ${e.message}`);
    }
  }
  console.log(`\nListo: ${ok} borradas, ${fail} con error.`);

  // Reinicia el contador CFDI del mes (para que la app se vea recién instalada).
  const cfdi = await prisma.cfdiUsage.deleteMany({ where: { shop } });
  if (cfdi.count) console.log(`Contador CFDI reiniciado (${cfdi.count} periodo(s)).`);
}
await prisma.$disconnect();
