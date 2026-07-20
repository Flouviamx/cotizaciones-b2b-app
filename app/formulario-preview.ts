// ARCHIVO CLIENTE-SEGURO. Genera el HTML de la vista previa FIEL del formulario
// de la tienda: replica el modal real (encabezado, stepper, 3 pasos, pie) tal
// como lo ve el comprador, sobre una página de producto simulada. Se inyecta en
// un <iframe srcDoc> dentro de la página /app/formulario.
//
// El paso visible lo controla React (no hay JS dentro del iframe, para que
// funcione bajo el CSP estricto del admin embebido). El CSS y la estructura son
// un espejo de
//   extensions/solicitar-cotizacion/blocks/solicitar_cotizacion.liquid
// para que "se vea como en la tienda". Si cambias el modal del liquid, refleja
// los cambios aquí. NO importar nada de servidor.

import type { FormularioConfig } from "./formulario-config";

export type PasoPreview = 1 | 2 | 3 | "ok";

function esc(s: string): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// `pro` controla si el paso 2 muestra los campos B2B (tel/empresa/RFC/términos),
// igual que en la tienda real. `paso` decide qué pantalla se ve.
export function construirPreviewFormulario(
  f: FormularioConfig,
  opts: { pro?: boolean; paso?: PasoPreview } = {},
): string {
  const pro = opts.pro !== false; // en el editor (solo Pro) siempre los mostramos
  const paso: PasoPreview = opts.paso ?? 1;
  const t = f.textos;
  const a = f.apariencia;
  const acento = a.colorAcento || "#1a73e8";
  const grad = `linear-gradient(135deg, ${acento}, #4285f4)`;

  const nPaso = paso === "ok" ? 3 : paso;
  const on = (n: PasoPreview) => (n === paso ? " on" : "");
  const dotClass = (n: number) =>
    "si" + (n === nPaso && paso !== "ok" ? " active" : "") + (n < nPaso || paso === "ok" ? " done" : "");
  const barW = (i: number) => (i < nPaso - 1 || paso === "ok" ? "100%" : "0");

  const footer =
    paso === "ok"
      ? `<button class="btn primary">↺ Ver de nuevo</button>`
      : `${paso > 1 ? `<button class="btn ghost">← Atrás</button>` : ""}
         ${paso < 3 ? `<button class="btn primary">Siguiente →</button>` : `<button class="btn primary">Enviar solicitud</button>`}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    background: #f1f2f5; color: #1a1a2e; }

  /* ---- Página de producto simulada (fondo) ---- */
  .store { padding: 22px; display: grid; grid-template-columns: 130px 1fr; gap: 20px;
    max-width: 560px; margin: 0 auto; opacity: .55; filter: saturate(.9); }
  .store-img { width: 130px; height: 150px; border-radius: 14px;
    background: linear-gradient(135deg, #e7eaf0, #d6dbe6); display:flex; align-items:center;
    justify-content:center; font-size: 34px; }
  .store-h { font-size: 20px; font-weight: 800; margin: 4px 0 6px; }
  .store-sub { font-size: 13px; color: #6b7280; line-height: 1.5; margin-bottom: 14px; }
  .store-btn { display:inline-block; border:0; border-radius: 8px; padding: 12px 22px;
    font-size: 15px; font-weight: 700; cursor: pointer; }

  /* ---- Modal (espejo del liquid) ---- */
  .ov { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 16px; background: rgba(15,23,42,.55); backdrop-filter: blur(3px); }
  .modal { --fq-accent: ${acento}; width: 100%; max-width: 480px; max-height: 94vh; display: flex;
    flex-direction: column; background: #fff; border-radius: 20px; overflow: hidden;
    box-shadow: 0 30px 70px -20px rgba(0,0,0,.5); }
  .head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px;
    background: ${grad}; color: #fff; }
  .head-t { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 800; }
  .x { background: rgba(255,255,255,.18); border: 0; color: #fff; width: 30px; height: 30px;
    border-radius: 999px; font-size: 20px; line-height: 1; cursor: pointer; }

  .stepper { display: flex; align-items: center; padding: 15px 20px 2px; }
  .si { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .sn { width: 28px; height: 28px; border-radius: 999px; display: flex; align-items: center;
    justify-content: center; font-size: 13px; font-weight: 800; background: #eef0f4; color: #9099a8; }
  .sl { font-size: 11px; font-weight: 700; color: #9099a8; }
  .si.active .sn { background: ${grad}; color: #fff; }
  .si.active .sl { color: #1a56c4; }
  .si.done .sn { background: #dcfce7; color: #15803d; }
  .sbar { flex: 1; height: 3px; background: #eef0f4; border-radius: 999px; margin: 0 8px 16px; overflow: hidden; }
  .sbar span { display:block; height:100%; background:${grad}; }

  .body { padding: 8px 20px 4px; overflow-y: auto; }
  .lead { font-size: 13.5px; color: #374151; margin: 4px 0 14px; line-height: 1.5; }
  .muted { color: #9099a8; font-size: 12px; }
  .panel { display: none; }
  .panel.on { display: block; }

  .prow { display:flex; align-items:center; gap:11px; padding:9px; border:1px solid #ececf0; border-radius:12px; margin-bottom:9px; }
  .pimg { width:46px; height:46px; border-radius:9px; background:#eef0f4; display:flex; align-items:center; justify-content:center; font-size:20px; }
  .pinfo { flex:1; min-width:0; }
  .pname { font-size:13px; font-weight:700; }
  .pvar { font-size:11.5px; color:#9099a8; }
  .qty { display:flex; align-items:center; border:1px solid #d8d8e0; border-radius:9px; overflow:hidden; }
  .qty b { width:26px; height:30px; display:flex; align-items:center; justify-content:center; background:#f7f8fa; font-size:16px; color:#374151; }
  .qty i { width:34px; text-align:center; font-size:13px; font-weight:700; font-style:normal; }

  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .full { grid-column:1 / -1; }
  .field { display:flex; flex-direction:column; }
  .label { font-size:12px; font-weight:700; color:#374151; margin-bottom:5px; }
  .req { color:#ef4444; }
  .input { width:100%; padding:9px 11px; border:1px solid #d8d8e0; border-radius:9px; font-size:13.5px;
    font-family:inherit; color:#1a1a2e; background:#fff; }
  textarea.input { resize:none; min-height:54px; }

  .rcard { border:1px solid #ececf0; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
  .rh { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; color:#9099a8; margin-bottom:8px; }
  .rrow { display:flex; justify-content:space-between; font-size:13px; padding:2px 0; }
  .rrow .q { color:#6b7280; font-weight:700; }
  .rc { display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:13px; }
  .rc .k { color:#9099a8; font-weight:700; }

  .foot { padding: 13px 20px 18px; border-top: 1px solid #f1f1f4; }
  .fbtns { display:flex; gap:9px; justify-content:flex-end; }
  .btn { border:0; border-radius:10px; padding:10px 18px; font-size:13.5px; font-weight:700; cursor:default; font-family:inherit; }
  .btn.primary { background:${grad}; color:#fff; }
  .btn.ghost { background:#fff; border:1.5px solid #d8d8e0; color:#374151; }

  .ok { text-align:center; padding:26px 18px; }
  .ok-ic { width:58px; height:58px; border-radius:999px; background:#dcfce7; color:#15803d; display:flex;
    align-items:center; justify-content:center; font-size:28px; margin:0 auto 14px; }
  .ok-t { font-size:18px; font-weight:800; margin-bottom:6px; }
  .ok-d { font-size:13.5px; color:#6b7280; line-height:1.5; max-width:320px; margin:0 auto; }

  /* Espejo del breakpoint real de la tienda (flouvia.css: @media max-width:560px)
     — sin esto, la vista previa "móvil" del admin se veía igual a "escritorio". */
  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
    .sl { display: none; }
    .modal { max-height: 96vh; }
  }
</style>
</head>
<body>
  <div class="store">
    <div class="store-img">🛍️</div>
    <div>
      <div class="store-h">Producto de ejemplo</div>
      <div class="store-sub">Así se ve el botón en la página de tu producto.</div>
      <button class="store-btn" style="background:${esc(a.botonBg)}; color:${esc(a.botonTextoColor)};">
        ${esc(a.textoBoton || "Solicitar cotización")}
      </button>
    </div>
  </div>

  <div class="ov">
    <div class="modal">
      <div class="head">
        <div class="head-t"><span>🧾</span><span>${esc(t.tituloModal || "Solicitar cotización")}</span></div>
        <button class="x" type="button" title="Solo vista previa">&times;</button>
      </div>

      ${
        paso === "ok"
          ? ""
          : `<div class="stepper">
        <div class="${dotClass(1)}"><span class="sn">1</span><span class="sl">Productos</span></div>
        <div class="sbar"><span style="width:${barW(0)}"></span></div>
        <div class="${dotClass(2)}"><span class="sn">2</span><span class="sl">Datos</span></div>
        <div class="sbar"><span style="width:${barW(1)}"></span></div>
        <div class="${dotClass(3)}"><span class="sn">3</span><span class="sl">Revisar</span></div>
      </div>`
      }

      <div class="body">
        <section class="panel${on(1)}">
          <p class="lead">${esc(t.leadPaso1)} <span class="muted">No modificamos tu carrito.</span></p>
          <div class="prow">
            <div class="pimg">📦</div>
            <div class="pinfo"><div class="pname">Camisa de algodón</div><div class="pvar">Talla M · Azul</div></div>
            <div class="qty"><b>−</b><i>2</i><b>+</b></div>
          </div>
          <div class="prow">
            <div class="pimg">📦</div>
            <div class="pinfo"><div class="pname">Pantalón clásico</div><div class="pvar">Talla 32</div></div>
            <div class="qty"><b>−</b><i>1</i><b>+</b></div>
          </div>
        </section>

        <section class="panel${on(2)}">
          <p class="lead">${esc(t.leadPaso2)}</p>
          <div class="grid">
            ${
              pro
                ? `<div class="field"><label class="label">Empresa</label><input class="input" value="ACME SA de CV" readonly /></div>
            <div class="field"><label class="label">RFC <span class="muted">(para tu factura)</span></label><input class="input" value="ACM010101AB1" readonly /></div>
            <div class="field"><label class="label">Términos de pago</label><input class="input" value="Net 30" readonly /></div>`
                : ""
            }
            <div class="field full"><label class="label">Notas</label><textarea class="input" readonly>Necesito 200 unidades, entrega antes del día 15.</textarea></div>
          </div>
          <p class="muted" style="margin-top:10px">Tus datos (nombre, correo, dirección) se piden en el checkout seguro de Shopify al pagar.</p>
        </section>

        <section class="panel${on(3)}">
          <p class="lead">${esc(t.leadPaso3)}</p>
          <div class="rcard">
            <div class="rh">Productos</div>
            <div class="rrow"><span>Camisa de algodón · Talla M</span><span class="q">×2</span></div>
            <div class="rrow"><span>Pantalón clásico · Talla 32</span><span class="q">×1</span></div>
          </div>
          <div class="rcard">
            <div class="rh">Datos B2B</div>
            <div class="rc">
              ${pro ? `<span class="k">Empresa</span><span>ACME SA de CV</span><span class="k">RFC</span><span>ACM010101AB1</span><span class="k">Términos</span><span>Net 30</span>` : `<span class="k">Notas</span><span>Necesito 200 unidades…</span>`}
            </div>
          </div>
        </section>

        <section class="panel${on("ok")}">
          <div class="ok">
            <div class="ok-ic">✓</div>
            <div class="ok-t">¡Solicitud enviada!</div>
            <div class="ok-d">${esc(t.mensajeExito)}</div>
          </div>
        </section>
      </div>

      <div class="foot">
        <div class="fbtns">${footer}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
