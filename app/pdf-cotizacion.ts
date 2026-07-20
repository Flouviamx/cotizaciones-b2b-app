// ARCHIVO CLIENTE-SEGURO. Genera el HTML imprimible de una cotización para
// "Guardar como PDF" desde el navegador. NO importar nada de servidor aquí
// (lo usan tanto app.quotes.$id.tsx como app.configuracion.tsx para el preview).

// Personalización del PDF que define el comerciante en Configuración → PDF.
// Se guarda dentro del metafield $app:flouvia (config.pdf).
export type PdfMarca = {
  color: string; // color de acento (encabezado + total)
  logo: string; // data URL del logo (o "" para usar monograma de iniciales)
  empresa: {
    direccion: string;
    telefono: string;
    email: string;
    web: string;
  };
  pie: {
    agradecimiento: string;
    vigencia: string;
    terminos: string;
  };
};

export const DEFAULT_PDF: PdfMarca = {
  color: "#1a73e8",
  logo: "",
  empresa: { direccion: "", telefono: "", email: "", web: "" },
  pie: {
    agradecimiento: "¡Gracias por su preferencia!",
    vigencia: "",
    terminos: "Los precios pueden estar sujetos a vigencia y disponibilidad.",
  },
};

// Combina lo guardado con los defaults (nunca falta una llave).
export function mergePdfMarca(raw: any): PdfMarca {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    color:
      typeof c.color === "string" && c.color.trim() ? c.color : DEFAULT_PDF.color,
    logo: typeof c.logo === "string" ? c.logo : DEFAULT_PDF.logo,
    empresa: { ...DEFAULT_PDF.empresa, ...(c.empresa ?? {}) },
    pie: { ...DEFAULT_PDF.pie, ...(c.pie ?? {}) },
  };
}

// Formato de moneda local (no compartimos helper entre rutas en este proyecto).
function formatoMoneda(amount: string | number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)} ${currency || ""}`.trim();
  }
}

// Escapa texto para insertarlo seguro en el HTML.
function esc(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Aclara un color hex mezclándolo con blanco (amt 0..1) para el degradado.
function lighten(hex: string, amt: number) {
  const h = String(hex || "").replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.padEnd(6, "0").slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

// Convierte saltos de línea de un texto libre en <br/> (ya escapado).
function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br/>");
}

export function construirHTMLcotizacion(opts: {
  folio: string;
  shopName: string;
  fecha: string;
  clienteNombre: string;
  clienteEmail: string;
  items: { title: string; quantity: number; price: string | number }[];
  moneda: string;
  discountPct: number;
  terminos: string;
  vigencia?: string;
  rfc: string;
  razonSocial: string;
  marca?: Partial<PdfMarca>;
}) {
  const marca = mergePdfMarca(opts.marca);
  const accent = marca.color || DEFAULT_PDF.color;
  const accent2 = lighten(accent, 0.22);
  const grad = `linear-gradient(135deg, ${accent}, ${accent2})`;

  const subtotal = opts.items.reduce(
    (acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantity) || 0),
    0,
  );
  const descuento = subtotal * (opts.discountPct / 100);
  const total = subtotal - descuento;
  const m = (n: number) => formatoMoneda(n, opts.moneda);

  const iniciales =
    (opts.shopName || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "•";

  const logoHTML = marca.logo
    ? `<img class="logo" src="${esc(marca.logo)}" alt="logo" />`
    : `<div class="mono">${esc(iniciales)}</div>`;

  // Líneas de contacto del vendedor (solo las que tengan dato).
  const e = marca.empresa;
  const empresaLineas = [e.direccion, e.telefono, e.email, e.web]
    .filter((x) => x && x.trim())
    .map((x) => `<div class="eline">${esc(x)}</div>`)
    .join("");

  const filas = opts.items
    .map((it, i) => {
      const cant = Number(it.quantity) || 0;
      const precio = Number(it.price) || 0;
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td class="prod">${esc(it.title)}</td>
        <td class="num">${cant}</td>
        <td class="num">${m(precio)}</td>
        <td class="num strong">${m(precio * cant)}</td>
      </tr>`;
    })
    .join("");

  const fiscalBloque =
    opts.rfc || opts.razonSocial
      ? `<div class="box">
          <h3>Datos fiscales</h3>
          ${opts.razonSocial ? `<p><span>Razón social</span>${esc(opts.razonSocial)}</p>` : ""}
          ${opts.rfc ? `<p><span>RFC</span>${esc(opts.rfc)}</p>` : ""}
        </div>`
      : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Cotización ${esc(opts.folio)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Arial, sans-serif;
    color:#1a1a2e; background:#fff; font-size:14px; line-height:1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width:760px; margin:0 auto; padding:0 40px 48px; }

  .hero { background:${grad}; color:#fff;
    margin:0 -40px 30px; padding:34px 40px; display:flex; justify-content:space-between; align-items:flex-start; gap:20px; }
  .brand { display:flex; align-items:flex-start; gap:14px; }
  .mono { width:52px; height:52px; border-radius:14px; background:rgba(255,255,255,.18);
    border:1.5px solid rgba(255,255,255,.45); display:flex; align-items:center; justify-content:center;
    font-size:21px; font-weight:800; letter-spacing:.02em; flex:0 0 auto; }
  .logo { width:56px; height:56px; object-fit:contain; background:#fff; border-radius:12px; padding:5px; flex:0 0 auto; }
  .brand .shop { font-size:20px; font-weight:800; }
  .brand .sub { font-size:12px; opacity:.85; margin-top:2px; }
  .brand .eline { font-size:11.5px; opacity:.92; margin-top:2px; }
  .hero .doc { text-align:right; flex:0 0 auto; }
  .hero .doc .t { font-size:13px; letter-spacing:.18em; text-transform:uppercase; opacity:.9; }
  .hero .doc .folio { font-size:26px; font-weight:800; margin-top:2px; }
  .hero .doc .fecha { font-size:12px; opacity:.9; margin-top:4px; }

  .grid { display:flex; gap:14px; margin-bottom:26px; flex-wrap:wrap; }
  .box { flex:1; min-width:200px; background:#f7f9fc; border:1px solid #e8ecf3;
    border-radius:12px; padding:15px 17px; }
  .box h3 { margin:0 0 9px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:${accent}; font-weight:800; }
  .box p { margin:5px 0; font-size:13.5px; }
  .box p span { display:block; font-size:11px; color:#8a93a3; text-transform:uppercase; letter-spacing:.03em; }
  .box .name { font-weight:700; font-size:15px; }

  table.items { width:100%; border-collapse:collapse; margin-bottom:6px; }
  table.items thead th { background:#1a1a2e; color:#fff; font-size:11px; text-transform:uppercase;
    letter-spacing:.05em; padding:11px 12px; text-align:left; }
  table.items thead th:first-child { border-radius:8px 0 0 8px; }
  table.items thead th:last-child { border-radius:0 8px 8px 0; }
  table.items td { padding:12px; border-bottom:1px solid #eef0f4; font-size:13.5px; vertical-align:top; }
  table.items tbody tr:nth-child(even) { background:#f7f9fc; }
  td.idx { color:#aab2c0; width:30px; font-variant-numeric:tabular-nums; }
  td.prod { font-weight:600; }
  .num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  th.num { text-align:right; }
  td.strong { font-weight:700; }

  .totwrap { display:flex; justify-content:flex-end; margin-top:18px; }
  .totales { width:300px; }
  .totales .row { display:flex; justify-content:space-between; padding:7px 4px; font-size:13.5px; color:#444; }
  .totales .row.desc { color:#15803d; }
  .totales .grand { display:flex; justify-content:space-between; align-items:center;
    margin-top:8px; padding:14px 16px; background:${grad}; color:#fff; border-radius:12px; }
  .totales .grand .lbl { font-size:13px; text-transform:uppercase; letter-spacing:.06em; opacity:.95; }
  .totales .grand .val { font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; }

  .pie { margin-top:40px; padding-top:16px; border-top:1px solid #e8ecf3; font-size:11.5px; color:#8a93a3; text-align:center; }
  .pie .gracias { color:#1a1a2e; font-weight:700; font-size:13px; margin-bottom:4px; }
  .pie .vig { color:${accent}; font-weight:600; margin-bottom:6px; }

  @media print { .page { padding:0 24px 24px; } .hero { margin:0 -24px 26px; padding:30px 24px; } }
</style></head>
<body>
  <div class="page">
    <div class="hero">
      <div class="brand">
        ${logoHTML}
        <div>
          <div class="shop">${esc(opts.shopName || "Tu tienda")}</div>
          <div class="sub">Cotización para tu cliente</div>
          ${empresaLineas}
        </div>
      </div>
      <div class="doc">
        <div class="t">Cotización</div>
        <div class="folio">${esc(opts.folio)}</div>
        <div class="fecha">${esc(opts.fecha)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Cliente</h3>
        <p class="name">${esc(opts.clienteNombre || "Sin cliente asignado")}</p>
        ${opts.clienteEmail ? `<p>${esc(opts.clienteEmail)}</p>` : ""}
      </div>
      <div class="box">
        <h3>Condiciones</h3>
        <p><span>Términos de pago</span>${esc(opts.terminos || "Contado")}</p>
        <p><span>Moneda</span>${esc(opts.moneda)}</p>
        ${opts.vigencia ? `<p><span>Vigencia</span>${esc(opts.vigencia)}</p>` : ""}
      </div>
      ${fiscalBloque}
    </div>

    <table class="items">
      <thead><tr>
        <th>#</th><th>Producto</th><th class="num">Cant.</th>
        <th class="num">Precio unitario</th><th class="num">Importe</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>

    <div class="totwrap">
      <div class="totales">
        <div class="row"><span>Subtotal</span><span class="num">${m(subtotal)}</span></div>
        ${
          opts.discountPct > 0
            ? `<div class="row desc"><span>Descuento (${opts.discountPct}%)</span><span class="num">− ${m(descuento)}</span></div>`
            : ""
        }
        <div class="grand"><span class="lbl">Total</span><span class="val">${m(total)}</span></div>
      </div>
    </div>

    <div class="pie">
      ${marca.pie.agradecimiento ? `<div class="gracias">${esc(marca.pie.agradecimiento)}</div>` : ""}
      ${marca.pie.vigencia ? `<div class="vig">${esc(marca.pie.vigencia)}</div>` : ""}
      ${marca.pie.terminos ? `${nl2br(marca.pie.terminos)}<br/>` : ""}
      Cotización generada con Flouvia Cotizaciones.
    </div>
  </div>
</body></html>`;
}
