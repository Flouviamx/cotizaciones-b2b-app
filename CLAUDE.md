# CLAUDE.md — Flouvia Cotizaciones B2B

Contexto del proyecto para Claude. Léelo antes de trabajar. Responder a Andre en **español**.

## Qué es

App de Shopify: **portal de cotizaciones B2B para México** ("Request a Quote"). El comprador
pide una cotización desde la tienda en vez de pagar directo; el vendedor negocia precios y manda
el link de pago. Incluye términos de crédito (Net 30/60), descuentos, empresas B2B y **CFDI**
(facturación electrónica MX). Caso real que la inspiró: El Zarco (pedidos por WhatsApp → Excel).

## Cómo correr (DEV)

```bash
cd ~/Desktop/flouvia-apps/cotizaciones-b2b-mx
npm run dev -- --use-localhost      # admin (estable, sin túnel Cloudflare)
npm run dev                          # solo para probar el botón en la tienda (storefront) — usa túnel
```
- El comando `shopify` global NO está en PATH → usar scripts npm.
- Verificar cambios con: `npm run typecheck` (filtrar: `| grep "error TS"`).
- Abrir la app desde **admin de la tienda → Apps**, NO desde la URL del túnel.
- Cerrar dev con `q`. Si sale `EADDRINUSE :9293`: `lsof -ti :9293 | xargs kill -9`.

## Stack

- **React Router 7** (no Remix) + TypeScript + Vite
- `@shopify/shopify-app-react-router` + App Bridge
- Prisma + SQLite (solo sesiones; NO guardamos PII de clientes)
- UI: **Polaris web components** (`<s-page>`, `<s-section>`, etc.) PERO ver "Diseño" abajo
- Tienda dev: `flouvia.myshopify.com` · org Partner: Flouvia · client_id en `shopify.app.toml`

## Diseño (IMPORTANTE)

Andre quiere **estética premium "para convencer"**. Decisión tomada:
- Color: **azul B2B** `#1a73e8` → gradiente a `#4285f4`. Verde para checks/éxito.
- **Todo el admin usa CSS custom**, NO los componentes Polaris para layout. Cada ruta inyecta su
  `<style>{CSS}</style>` con clases (prefijos: `fp-` planes, `dh-` inicio/dashboard, `dq-` lista cotiz, `nq-` nueva cotiz, `qd-` detalle cotiz, `ct-` contacto, `cf-` configuración, `an-` analítica, `em-` empresas).
- **Inputs NATIVOS estilizados** (`<select>`, `<input>`, `<textarea>`) en vez de `s-select`/`s-money-field`/etc.
  (Polaris tiene shadow DOM → no se puede re-estilizar; por eso se usan nativos para consistencia).
- Se conservan APIs de App Bridge: `shopify.resourcePicker`, `shopify.toast`, `useAppBridge`.
- Responsive con CSS media queries reales + `repeat(auto-fit, minmax(...))` en grids.
- Sin testimonios falsos (Shopify los prohíbe).
- Hero banners con gradiente azul + círculo decorativo `::after` — patrón consistente en Inicio y Contacto.

## Moneda (IMPORTANTE)

- **Siempre usar `shopMoney`**, NUNCA `presentmentMoney`. `shopMoney` es el monto en la **moneda base de la tienda del comerciante** (Shopify ya lo convierte). `presentmentMoney` es lo que vio el comprador final (puede ser CAD, USD, etc.) y no sirve para el admin.
- Todas las rutas del admin (`app._index`, `app.quotes._index`, `app.analitica`, `app.quotes.$id`) usan `shopMoney` en sus GraphQL queries.
- Formato de moneda: usar el helper local `formatoMoneda(amount, currency)` que usa `Intl.NumberFormat("es-MX", { style: "currency" })`. Cada ruta define su propia copia del helper (no hay archivo shared todavía). Incluye fallback para currencies desconocidas.
- En `priceOverride` al guardar productos en el detalle de cotización se usa `shopMoney.currencyCode` como `currencyCode` — es la moneda correcta para la tienda.
- Para CFDI el monto correcto también es `shopMoney` (debe coincidir con la factura en la moneda de la tienda).

## Planes / Billing

- **3 tiers: Gratis · Básico · Pro.** Gratis NO es una suscripción de Shopify (no cobra
  nada): "Gratis" = la tienda no tiene ningún plan de pago activo (`!hasActivePayment`).
  Es el gancho de adquisición.
- 4 planes DE PAGO en `app/plans.ts` (archivo cliente-seguro, SIN imports de servidor):
  `PLAN_BASICO_MENSUAL` $29, `PLAN_BASICO_ANUAL` $290 (10 meses), `PLAN_PRO_MENSUAL` $59,
  `PLAN_PRO_ANUAL` $590. Helpers `PLANES_PRO`, `TODOS_LOS_PLANES`. Constantes del free:
  `PLAN_FREE`, `LIMITE_FREE` (= 5).
- `shopify.server.ts` importa precios/nombres de `./plans` y los re-exporta.
- **Gating Gratis (límite):** `app/limites.server.ts` → `evaluarLimite(admin)` devuelve
  `{ paid, activas, limite, bloqueado }`. `paid` = tiene Básico o Pro (sin tope). `activas` =
  Draft Orders NO `COMPLETED` (las pagadas liberan cupo). `bloqueado` = Gratis + `activas >= 5`.
  Funciona con cualquier `admin.graphql` (rutas admin Y App Proxy). Se aplica al CREAR en:
  `app.quotes.new.tsx` (loader+action), `create.tsx` (storefront, status 403 con mensaje suave),
  `app.quotes._index.tsx` (botón de ejemplo). El admin SIEMPRE deja entrar (el tope es al crear,
  no al navegar) para que prueben la app.
- Gating Pro: `PLANES_PRO.includes(sub.name)`. Features Pro: CFDI, Empresas B2B (+ asignar
  empresa en la cotización), Analítica, Formulario personalizable, campos B2B en el modal del
  storefront (teléfono, empresa, RFC, términos de crédito).
- **Correos:** el aviso al vendedor (`adminNueva`) se envía en TODOS los planes (incluido
  Gratis) — si no, la app no avisa nada y no sirve. La confirmación al comprador y el envío
  de la cotización por email (`sendInvoice`) son desde Básico (`paid`). Descuentos NO se gatean.
- Features Básico (gateadas a `paid`): sin tope, sin badge, confirmación al comprador, enviar
  por email, plantillas de correo editables, términos de crédito, PDF con logo/marca.
- Diferencias **Gratis vs Básico**: el tope de 5 cotizaciones activas y el badge
  "Cotizaciones por Flouvia" en el modal del storefront (se oculta con cualquier plan de pago).
  `config.tsx` devuelve `paid` además de `pro`; el liquid muestra `[data-flouvia-brand]` si `!paid`.
- `BILLING_TEST = true` en `app.plans.tsx` → **cambiar a `false` en producción**. (Ya NO está en
  `app.tsx`: ese loader dejó de hacer `billing.check`/redirect; solo autentica.)
- Enforcement: `app.tsx` loader ya NO redirige a `/app/plans` (Gratis es válido). Sin plan de pago,
  la tienda usa la app con el tope del Plan Gratis.

## Qué feature va en qué plan

**Patrón de UX: "todo visible, lo de pago bloqueado".** En el admin TODO se ve siempre
(rutas, pestañas, botones), pero lo que no está en el plan sale con un candado 🔒 + teaser
que lleva a `/app/plans`. Nunca se ocultan funciones; se bloquean.

```
Gratis (hasta 5 cotizaciones activas)
  ✓ Botón "Solicitar cotización" en tienda (nombre + email)
  ✓ Personalizar texto del botón + mostrar precio de lista (Configuración → Botón)
  ✓ Ocultar precios y botón "Agregar al carrito" en la tienda (modo solo cotización)
  ✓ Ver / editar cotizaciones (precios, cantidades, descuento)
  ✓ Link de pago al cliente (abrir / copiar — NO enviar por email)
  ✓ Convertir cotización en pedido con 1 clic
  ✓ PDF descargable (diseño por defecto, sin logo ni marca)
  ✓ Aviso al vendedor cuando llega una cotización (correo adminNueva)
  ✗ Badge "Cotizaciones por Flouvia" visible en el modal (se oculta con plan de pago)
  ✗ Confirmación automática al comprador, enviar por email, plantillas, términos, PDF con marca

Básico $29/mes
  ✓ Todo lo de Gratis, sin tope, sin badge
  ✓ Confirmación automática al comprador
  ✓ Enviar cotización por email con link de pago (sendInvoice)
  ✓ Plantillas de correo editables (los 3 correos)
  ✓ Términos de crédito (Net 30/60…) — en cotización y en Configuración → Crédito
  ✓ PDF con logo + personalización completa (color, datos empresa, pie)

Pro $59/mes
  ✓ Todo lo de Básico
  ✓ Empresas B2B + límite de crédito + asignar empresa en la cotización
  ✓ Campos B2B en formulario del storefront (tel, empresa, RFC, términos)
  ✓ Formulario de cotización personalizable (app.formulario)
  ✓ Analítica avanzada (KPIs, embudo, pipeline, top clientes)
  ✓ Facturación CFDI 4.0 (Facturama)
```

**Gates implementados (candados):**
- `create.tsx`: aviso al vendedor (`adminNueva`) en TODOS los planes (incluido Gratis).
  Confirmación al comprador solo si `paid`.
- `app.quotes.$id.tsx`: "Convertir en pedido" sin gate. **Términos de crédito** y **enviar
  por email** (`sendInvoice`) requieren `hasPaid` (UI con candado + guard en el action que
  hace `billing.check`). **Asignar empresa B2B** requiere `hasPro` (UI con candado). PDF aplica
  marca solo si `hasPaid`; en Gratis sale con diseño por defecto.
- `app.configuracion.tsx`: las pestañas **Correos**, **Crédito** y **PDF** se ven siempre, pero
  en Gratis muestran una `lockCard` (candado) en vez del editor. Fiscal/Notificaciones/Botón
  abiertas en todos los planes.
- `app.empresas.tsx`, `app.analitica.tsx`, `app.formulario.tsx`: teaser con candado si no es Pro.

## Modelo de datos

Las cotizaciones SON **Draft Orders** de Shopify. Metadata extra se guarda en `customAttributes`
del draft order (Términos de crédito, Origen, Solicitante, datos CFDI, CFDI UUID). NUNCA reemplazar
customAttributes directo → usar el helper `mergeCustomAttributes` (lee actuales y mezcla).

## Navegación (s-app-nav)

Orden en `app.tsx`: **Inicio** → **Cotizaciones** → **Empresas** → **Analítica** → **Configuración** → **Planes** → **Contacto**
- Tras aprobar un plan, Shopify redirige a `/app` → cae en el dashboard Inicio (no en cotizaciones).
- Enforcement de billing en `app.tsx` loader: sin plan → `redirect("/app/plans" + url.search)`.

## Archivos clave

- `app/routes/app._index.tsx` — **Inicio / Onboarding Dashboard**: hero, guía de primeros pasos con barra de progreso, detalles del plan activo, actividad reciente (últimas 5), badges de ayuda
- `app/routes/app.quotes._index.tsx` — lista de cotizaciones (stats, filtros, búsqueda)
- `app/routes/app.quotes.new.tsx` — crear cotización (resourcePicker)
- `app/routes/app.quotes.$id.tsx` — detalle (precios, cliente, empresa, términos, CFDI, link pago,
  **convertir en pedido** con `draftOrderComplete(paymentPending:true)`, **PDF descargable** vía iframe+print).
  Lee `config.pdf` del metafield para aplicar la marca al PDF. El estado `COMPLETED` = ya es pedido
  (no leer `draftOrder.order { }` — requiere scope `read_orders` que la app no tiene; error #16).
- `app/routes/app.analitica.tsx` — **Analítica** (Plan Pro, con teaser/upsell si no es Pro): KPIs animados, filtro de rango, embudo, gráfica por mes, top 5 clientes.
- `app/routes/app.empresas.tsx` — **Empresas B2B** (Plan Pro): tarjetas, límite de crédito (metafield `$app:flouvia`/`credito_limite`), crédito en uso por Draft Orders OPEN+INVOICE_SENT.
- `app/routes/app.configuracion.tsx` — **Configuración** (6 pestañas): Datos fiscales · Notificaciones · Correos · Crédito · Botón · **PDF** (nueva). Guarda todo en UN metafield JSON (`$app:flouvia`/`config`). La pestaña PDF permite: logo (data URL, tope ~250 KB), color de marca, datos de empresa (dirección/tel/email/web), pie editable (agradecimiento/vigencia/términos). Preview en vivo en iframe igual que correos.
- `app/routes/app.plans.tsx` — página de planes (billing.request)
- `app/routes/app.contacto.tsx` — formulario de contacto + soporte directo
- `app/routes/create.tsx` — App Proxy POST: crea draft order desde la tienda. Aplica tope Gratis, correos solo con plan de pago.
- `app/routes/config.tsx` — App Proxy GET: devuelve `{ pro, paid, config: { boton, credito } }` para el modal del storefront.
- `app/pdf-cotizacion.ts` — **ARCHIVO CLIENTE-SEGURO** compartido. Genera el HTML imprimible del PDF. Exporta: `PdfMarca` (tipo), `DEFAULT_PDF`, `mergePdfMarca`, `construirHTMLcotizacion`. Usado por `app.quotes.$id.tsx` (generar PDF real) y `app.configuracion.tsx` (preview en vivo). La función `lighten()` calcula el gradiente a partir del color hex del comerciante. NO importar nada de servidor aquí.
- `app/facturama.server.ts` — timbrado CFDI (Facturama)
- `app/email-templates.ts` — **ARCHIVO CLIENTE-SEGURO**: layout de correos HTML, render de variables, tipos, defaults, helpers `construirCorreo`/`tablaDatos`/`mergeEmails`.
- `app/notify.server.ts` — 4 funciones de envío vía Resend: `notifyMerchantNewQuote`, `notifyRequesterQuoteReceived`, `notifyRequesterQuoteSent`, `sendContactMessage`.
- **Estado de `sendInvoice`**: usa correo Resend propio (NO `draftOrderInvoiceSend`). El estado NO avanza a `INVOICE_SENT`; se guarda `customAttribute` "Cotización enviada" con la fecha.
- `extensions/solicitar-cotizacion/` — theme app extension. **Refactorizada a core compartido + 2 bloques** (antes era un solo bloque con todo embebido):
  - `assets/flouvia.css` + `assets/flouvia.js` — el modal de 3 pasos (Productos → Contacto → Revisar) y TODA la lógica, en UN solo modal compartido (singleton, se crea una vez y se mueve a `<body>`). API `window.FlouviaQuote`: `openFromCart()`, `openProduct(handle)`, `initFloating(opts)`, `initCards(opts)`, `initCartButton(opts)`. Disparadores estáticos por delegación con `[data-flouvia-open]` (`"cart"` o `"handle:xxx"`). Guard `window.__FlouviaLoaded` para no ejecutarse dos veces (lo cargan ambos bloques). Paso 2 muestra campos B2B (tel/empresa/RFC/términos) solo en Plan Pro (vía `/config`). Badge de marca en Gratis.
  - `blocks/solicitar_cotizacion.liquid` — **app block** (`target: section`), típicamente en la página de producto. Botón disparador + JSON `[data-flouvia-product]` para cotizar el producto actual aunque el carrito esté vacío. Modo "solo cotización": oculta precio/botón carrito con CSS del servidor.
  - `blocks/flouvia_global.liquid` — **app embed** (`target: body`), corre en toda la tienda. Enciende (con toggles) el **botón flotante**, el **botón en cada tarjeta de producto**, el **botón en /cart**, el **carrito de cotización (drawer/pestaña)** y el **botón "Agregar a cotización" en producto**. Es la única vía sin-código para llegar a las tarjetas de carruseles nativos (Shopify no deja meter app blocks dentro de las tarjetas). Config del modal (título/éxito/acento/redondeo/oscurecido) con `window.FLOUVIA_CONFIG` (la primera instancia en la página gana). **Panel rediseñado (jun 2026):** sección "🎨 Estilo general" define color/forma/tamaño/grosor UNA vez y cada botón lo hereda; cada botón tiene un check `*_custom` que revela sus colores propios (resueltos en Liquid con `{% liquid %}`, no en JS). El panel se colapsa con `visible_if` (cada campo aparece solo si su función está encendida). Los dos botones de tarjeta viejos (Cotizar + Agregar) se **fusionaron** en un solo selector `cards_action` (`none`/`quote`/`add`). El JS resuelve estilos heredados desde Liquid; las nuevas opciones (`weight`, `shadow`, `iconPos`, `hideMobile`, `paddingY/X`, `width`, modal `radius`/`overlay`) se pasan por opts.
- `.env` — RESEND_API_KEY, FACTURAMA_USER/PASSWORD/CP, CONTACT_TO (gitignored)

## Errores que tuvimos + soluciones (NO repetir)

1. **Túnel Cloudflare NXDOMAIN / "no se pudo encontrar la IP"** → usar `npm run dev -- --use-localhost` para el admin. El túnel solo se necesita para storefront/webhooks.
2. **`s-app-nav` Type error** → parche en `app/polaris-shims.d.ts`.
3. **App proxy "Error de conexión"** → Shopify QUITA prefijo+subpath; la ruta es `create.tsx` (`/create`).
4. **Theme schema "default can't be blank"** → campos `text` NO aceptan `"default": ""`. Omitir el default.
5. **Dev store no deja quitar protección por contraseña** → es normal; el CLI la maneja solo.
6. **DraftOrder "Access denied" / "not approved Protected Customer Data"** → faltaba scope `write_draft_orders` + activar Protected Customer Data en el dashboard.
7. **`purchasingCompany` companyId null** → `PurchasingCompanyInput` requiere los 3: `companyId`, `companyContactId`, `companyLocationId`.
8. **Precio en Draft Order** → usar `priceOverride: { amount, currencyCode }` (NO `originalUnitPrice`). Cliente = `purchasingEntity.customerId`. Descuento = `appliedDiscount`.
9. **"Server-only module referenced by client"** → no importar de `shopify.server.ts` en componentes. Constantes compartidas van en `app/plans.ts`.
10. **Redirect a /app/plans pedía "iniciar sesión con dominio"** → el redirect perdía query params. Solución: `redirect("/app/plans" + url.search)`. Check con `url.pathname.includes("/app/plans")`.
11. **"Managed Pricing Apps cannot use the Billing API"** → desactivar Managed Pricing en Partner Dashboard.
12. **"Error desconocido al iniciar el cobro" / `{}`** → `try/catch` atrapaba el `Response` del redirect. Fix: `if (e instanceof Response) throw e;`.
13. **Facturama 401** → las credenciales del panel NO son las de la API. Endpoint sandbox: `https://apisandbox.facturama.mx/3/cfdis`.
14. **`draftOrders` sortKey `CREATED_AT` inválido** → usar `sortKey: UPDATED_AT`. `createdAt` SÍ existe como dato del nodo pero no como sort key.
15. **`Company.contactCount` "Selections can't be made on scalars"** → `contactCount` devuelve `Int` directo; NO `{ count }`. En cambio `ordersCount` SÍ es objeto → `ordersCount { count }`.
16. **`draftOrder.order { }` → "Access denied for order field"** → leer el pedido vinculado requiere scope `read_orders` que la app NO tiene. **Nunca pedir el campo `order` en queries de draft orders.** Para detectar si ya se convirtió en pedido, usar `status === "COMPLETED"`.

## Convenciones de trabajo con Andre

- Es Shopify Partner principiante. Explicar paso a paso, en español.
- Cuando dice **"sigue"** = ya probó la función en vivo y funciona (luz verde).
- Pega snippets de tutoriales viejos (Remix/Polaris React) → traducir a los patrones nuevos.
- Verificar campos de la API en la doc antes de escribir GraphQL (no adivinar).
- Ser honesto sobre qué NO se probó en vivo.

## Variables de entorno (.env)

| Variable | Descripción |
|---|---|
| `RESEND_API_KEY` | Clave de API de Resend (email al vendedor + mensajes de contacto) |
| `RESEND_FROM` | Remitente de emails (default: `onboarding@resend.dev`, en prod dominio verificado) |
| `CONTACT_TO` | Bandeja donde llegan los mensajes de contacto (default: `soporte@flouvia.com`) |
| `FACTURAMA_USER` / `FACTURAMA_PASSWORD` / `FACTURAMA_CP` | Credenciales CFDI (Plan Pro) |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_URL` | Generados por Shopify CLI |

## Pendiente para publicar

- Desactivar `BILLING_TEST` (false) en `app.plans.tsx` en producción.
- Configurar `CONTACT_TO` y `RESEND_FROM` con valores reales de producción.
- Hostear `PRIVACY.md` en URL pública (https://flouvia.com/privacidad).
- Completar listing en Partner Dashboard (ver `LISTING.md`).
- App necesita URL de producción real (el `application_url` sigue en example.com).
- CFDI: validar timbrado real contra Facturama (afinar payload si hay errores de claves SAT).
- `app.quotes.new.tsx`: leer `config.credito.porDefecto` del metafield para preseleccionar el término al crear cotización manual.
- Webhooks GDPR ya están (`webhooks.customers.*`, `webhooks.shop.redact`).
