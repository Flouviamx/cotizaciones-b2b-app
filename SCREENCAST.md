# Screencast de demostración para App Review (~8 min)

Este es el video de FUNCIONAMIENTO que pide el revisor (no confundir con el
promo de 75 s del listing, que está en `LISTING.md`). Requisitos del rechazo
4.5.3 (jul 2026): **en inglés o con subtítulos en inglés** y mostrar
**explícitamente el setup en el storefront** (theme editor → app embeds).

Cada escena trae: qué hacer clic por clic (español) y la línea de narración /
texto en pantalla (inglés). Si no quieres hablar en inglés, di lo mismo en
español y pon los subtítulos en inglés con CapCut (auto-subtitles → traducir).

---

## Antes de grabar (checklist)

1. **Tienda limpia**: corre `node scripts/borrar-cotizaciones.mjs` (lista) y
   luego con `--borrar` (elimina todas las cotizaciones + reinicia contador
   CFDI). ⚠️ Antes abre la app una vez en el admin para refrescar el token.
2. **Billing en modo prueba**: verifica que en Vercel NO esté
   `SHOPIFY_BILLING_TEST="false"` mientras grabas (así los planes se aprueban
   sin cobrar). Al terminar, regrésala a `"false"` para producción.
3. **Plan actual = Gratis** (cancela cualquier plan de prueba activo) — así
   puedes demostrar upgrade Y downgrade en el mismo video.
4. **Cliente de prueba** en la tienda con sesión iniciada en una ventana
   normal, y el **admin en otra ventana** (no pestaña: facilita el cambio).
5. **CFDI en modo Pruebas** conectado (CSD del SAT de prueba, `csd-pruebas/`).
6. Resolución 1920×1080, zoom del navegador 90%, No Molestar activado, sin
   URLs de túneles ni API keys en pantalla.
7. App embed de Flouvia **apagado** antes de empezar (lo vas a encender EN
   cámara — es el requisito del revisor).

---

## Escena 1 — Intro y dashboard (0:00 – 0:40)

Admin de Shopify → Apps → Flouvia. Se ve el dashboard de Inicio recién
instalado (guía de primeros pasos, 0 cotizaciones).

> 🎙 "Hi, this is Flouvia — a B2B Request-a-Quote portal for Shopify, built
> for Mexico. Buyers request quotes from your storefront, you negotiate
> prices in the admin, and customers pay through Shopify's own checkout.
> This is the dashboard right after installing: a setup guide walks the
> merchant through every step."

Recorre con el mouse la guía de primeros pasos (sin hacer clic aún).

## Escena 2 — Setup en el storefront (0:40 – 1:50) ⚠️ LO PIDE EL REVISOR

1. Online Store → Themes → **Customize**.
2. Barra izquierda → ícono de apps → **App embeds** → busca "Cotizaciones
   Flouvia" → enciéndelo.
3. En el panel del embed: activa **botón flotante**, **botón en tarjetas**
   (elige "Abrir cotización") y **botón en /cart**. Muestra 3 segundos la
   sección "🎨 Estilo general" (color, forma, tamaño).
4. **Save**.
5. Ve a una página de producto → **Add block → Apps → Solicitar cotización**
   → Save. (Muestra que también existe el app block.)
6. Abre la tienda y muestra: botón flotante + botón en las tarjetas + botón
   en producto.

> 🎙 "Setup takes under a minute and needs no code. In the theme editor,
> enable the Flouvia app embed and choose which buttons you want: a floating
> button, a button on every product card, and a button on the cart page.
> You can also add an app block directly on the product page. Style is
> configured once and every button inherits it. Save — and the store is
> ready to take quote requests."

## Escena 3 — El comprador solicita una cotización (1:50 – 3:10)

Ventana del cliente (sesión ya iniciada).

1. Navega el catálogo, entra a un producto, clic en **Solicitar cotización**.
2. Modal paso 1: cambia una cantidad. → "Siguiente".
3. Paso 2: llena Empresa, RFC, términos "Net 30", una nota. Menciona que NO
   se piden nombre/email/teléfono.
4. Paso 3: revisa → **Enviar solicitud** → pantalla de éxito con folio.
5. (Opcional 10 s) Muestra también el flujo desde el carrito con 2 productos.

> 🎙 "Now as a buyer. The buyer must be logged in — Flouvia never collects
> personal data in the widget; name, email and address are captured later by
> Shopify's checkout. The quote flow has three steps: confirm products and
> quantities, add optional B2B details — company, tax ID, requested credit
> terms — and review. Submit, and the buyer gets a quote number instantly."

> 💬 Texto en pantalla: "No personal data collected — Shopify checkout
> captures it"

## Escena 4 — El vendedor gestiona la cotización (3:10 – 4:40)

Ventana del admin.

1. Dashboard: se ve la nueva solicitud en actividad reciente (y menciona que
   llegó aviso por email).
2. Abre la cotización → detalle: productos, datos B2B del comprador.
3. **Edita el precio** de un producto (precio negociado), **agrega 10% de
   descuento** → Guardar. El total se recalcula.
4. Asigna términos de crédito Net 30.
5. **Descarga el PDF** → muéstralo 3 segundos (con logo y marca).

> 🎙 "The merchant gets an email alert and sees the request in the app.
> Inside the quote: negotiate unit prices, apply a discount, set credit
> terms like Net 30, and download a branded PDF for the customer."

## Escena 5 — Pago vía checkout de Shopify (4:40 – 5:40) ⚠️ regla 1.1.2

1. En el detalle: **Enviar por email** (muestra el correo recibido con el
   botón de pago) o **Copiar link de pago**.
2. Ventana del cliente: abre el link → es el **checkout nativo de Shopify**
   con los precios negociados. Complete el pago (Bogus Gateway: tarjeta `1`).
3. Admin: la cotización pasa a **Pagada/COMPLETED** y el pedido aparece en
   Orders.

> 🎙 "When the quote is ready, the merchant sends the payment link. This
> opens Shopify's own secure checkout with the negotiated prices — Flouvia
> never bypasses checkout. Once the buyer pays, the draft order becomes a
> real order automatically."

## Escena 6 — Features Pro: Empresas, Formulario, Analítica, CFDI (5:40 – 6:50)

*(Necesitas el Plan Pro activo — si grabas la Escena 7 antes, ya lo tienes;
o suscríbete aquí y aprovecha para mostrar el flujo de upgrade.)*

1. **Empresas** (`/app/empresas`): tarjetas con límite de crédito y crédito
   en uso.
2. **Formulario** (`/app/formulario`): personaliza un texto del modal.
3. **Analítica** (`/app/analitica`): KPIs, embudo, top clientes.
4. **CFDI**: en el detalle de una cotización pagada, datos fiscales →
   **Generar factura CFDI** (modo pruebas) → aparece el UUID (folio fiscal).

> 🎙 "On the Pro plan: B2B companies with credit limits, a customizable quote
> form, revenue analytics, and automatic CFDI 4.0 electronic invoicing for
> Mexico — 250 invoices per month included. One click stamps the invoice and
> stores the fiscal UUID on the quote."

## Escena 7 — Planes: suscribir, subir, bajar y cancelar (6:50 – 7:50) ⚠️ 1.2.2/1.2.3

1. `/app/plans`: muestra los 4 planes (Gratis, Básico, Pro, Plus) y el
   toggle mensual/anual.
2. Suscríbete a **Básico** → pantalla de aprobación de Shopify → Aprobar.
3. De regreso: sube a **Pro** (Shopify prorratea) → Aprobar.
4. **Baja al plan Gratis**: botón "Cambiar al plan Gratis" → confirmación de
   dos pasos → banner de éxito. Muestra que el plan activo ahora es Gratis.

> 🎙 "Merchants manage their subscription entirely inside the app. Upgrade
> from Free to any paid plan through Shopify's billing screen, switch plans
> any time — Shopify prorates automatically — and downgrade back to the Free
> plan or cancel with two clicks. No support ticket needed."

## Escena 8 — Cierre (7:50 – 8:10)

Vuelve al dashboard con la cotización pagada visible.

> 🎙 "That's Flouvia: quotes from the storefront, negotiation in the admin,
> payment through Shopify checkout, and CFDI invoicing built in. Thanks for
> watching."

---

## Checklist final

- [ ] Inglés hablado o subtítulos en inglés en TODO el video.
- [ ] Se ve el theme editor encendiendo el app embed (Escena 2).
- [ ] Se ve que el pago es SOLO por el checkout de Shopify (Escena 5).
- [ ] Se ve suscribir Y bajar a Gratis/cancelar (Escena 7).
- [ ] Sin testimonios, sin estrellas, sin URLs de túnel, sin API keys.
- [ ] MP4 16:9, < 8:30 min. Subir a Loom/YouTube unlisted y pegar la URL en
      el Partner Dashboard como proof of resolution.
