# Listing — Flouvia Cotizaciones B2B
# Copia y pega cada campo en el Partner Dashboard → App setup → Listing

---

## App name (max 30 caracteres)
Flouvia Cotizaciones B2B
# ↑ 24/30 ✅

---

## Introduction (max 100 caracteres)
# Qué hace tu app y el beneficio principal — 2 oraciones breves
Portal B2B para gestionar cotizaciones con precios negociados y CFDI en México.
# ↑ 79/100 ✅

---

## App details (max 500 caracteres)
# Sin links, sin formato, sin jerga, sin estadísticas
¿Tus pedidos B2B llegan por WhatsApp y los capturas en Excel? Flouvia digitaliza ese proceso dentro de Shopify. Tus compradores solicitan cotizaciones desde el carrito, la página de producto o un botón flotante; tú negocias precios producto por producto y envías el link de pago o un PDF con tu marca; tu cliente paga de forma segura en el checkout de Shopify. Incluye términos de crédito (Contado, Net 30, Net 60), descuentos, empresas con crédito, analítica y facturación CFDI para México en el Plan Pro.

---

## Features (3 mínimo, 5 máximo — max 80 caracteres cada una)

Feature 1:
Solicita cotización desde el carrito, la página de producto o flotante

Feature 2:
Negocia precios por producto, aplica descuentos y manda link de pago o PDF

Feature 3:
Envía el link de pago y el cliente paga seguro en el checkout de Shopify

Feature 4:
Empresas con límite de crédito, términos Net 30/60 y analítica B2B

Feature 5:
Facturación CFDI automática ante el SAT para México (Plan Pro)

# Verificar que cada Feature sea ≤80 caracteres con: wc -m

---

## App card subtitle (max 62 caracteres)
# Aparece en búsquedas junto a otras apps — una oración clara
Cotizaciones B2B con precios negociados y CFDI para México
# ↑ 58/62 ✅

---

## Search terms (max 5 términos, max 20 caracteres cada uno)
cotizaciones B2B
factura CFDI
pedidos mayoreo
precio mayorista
ventas B2B

---

## Primary category
B2B  (si no existe: "Selling" o "Orders and shipping")

## Languages
Español (es) — idioma principal

---

## Support

Preferred support channel: Email
Support email address: hola@flouvia.com
Developer website: https://flouvia.com

---

## Resources

Privacy policy URL:
https://flouvia.com/privacidad

---

## Pricing (copia cada plan)

Plan Gratis — $0.00 USD
Descripción: Hasta 5 cotizaciones activas. Botón "Solicitar cotización" en carrito, producto y flotante, precios negociados por producto, descuentos, link de pago (checkout de Shopify), PDF descargable y modo "solo cotización" (oculta precios y carrito). Incluye la marca "Cotizaciones por Flouvia" en la ventana del cliente. Ideal para empezar sin costo.

Plan Básico Mensual — $29.00 USD / mes
Descripción: Cotizaciones ilimitadas (sin la marca Flouvia), correos automáticos de aviso y confirmación con plantillas editables, envío de la cotización por email, PDF con tu logo y marca, términos de crédito Contado / Net 30 / Net 60, precios negociados, descuentos y clientes automáticos. Incluye 7 días de prueba gratis.

Plan Básico Anual — $290.00 USD / año  (equivale a 10 meses, 2 gratis)
Descripción: Todo el Plan Básico Mensual con 2 meses de ahorro. Incluye 7 días de prueba gratis.

Plan Pro Mensual — $59.00 USD / mes
Descripción: Todo lo del Plan Básico más facturación CFDI automática, empresas B2B con límite de crédito, campos B2B en la tienda (teléfono, empresa, RFC, términos), formulario de cotización personalizable, analítica avanzada y soporte prioritario. Incluye 7 días de prueba gratis.

Plan Pro Anual — $590.00 USD / año  (equivale a 10 meses, 2 gratis)
Descripción: Todo el Plan Pro Mensual con 2 meses de ahorro. Incluye 7 días de prueba gratis.

---

## Pricing URL (opcional)
https://flouvia.com/cotizaciones-b2b

---

## Sales channel requirements
✅ Shopify Online Store (la app incluye una theme app extension para el botón en la tienda)

## Geographic requirements
✅ Merchant's business address must be in a specific country/region → México
(el CFDI y la lógica fiscal son exclusivos de México)

---

## Contact information

Merchant review email: hola@flouvia.com
App submission email: hola@flouvia.com

---

## Test account (para el revisor de Shopify)

Username: (tu email de tienda de desarrollo)
Password: (contraseña de la tienda de desarrollo)
Account description: Acceso completo al admin de la tienda de prueba con la app instalada y el Plan Pro activo. El billing está en modo TEST — no se realiza ningún cargo.

---

## Testing instructions (max 2800 caracteres)

Para probar Flouvia Cotizaciones B2B:

VENDEDOR (admin):
1. Abre la app en Apps → Flouvia. Si no tienes plan, en "Planes" elige "Plan Pro Mensual" (modo TEST, sin cargo) y aprueba.
2. "Cotizaciones" → "Nueva cotización": elige productos, cantidades, términos de crédito y cliente → "Crear".
3. Abre la cotización: edita precios, aplica descuento, asigna empresa; usa "Abrir link de pago", "Descargar PDF" y "Enviar por email". El cliente paga en el checkout de Shopify y el pedido se crea automáticamente.
4. "Empresas": crédito por empresa. "Analítica": ingresos y conversión. "Formulario": campos del formulario (Pro).
5. "Configuración": pestañas Datos fiscales, Notificaciones, Correos, Crédito, Botón y PDF.
6. CFDI 4.0 (Pro): en "Configuración" → "Datos fiscales" → "Conectar facturación CFDI" sube tu CSD del SAT (.cer + .key + contraseña) y conecta. Deja el toggle en "Pruebas". Para probar usa el CSD público del SAT: RFC EKU9003173C9, contraseña 12345678a.
7. Emitir factura: en una cotización, sección "Datos fiscales (CFDI)", captura el RFC del cliente → "Generar factura CFDI" (sale el folio/UUID). Receptor de prueba: RFC XAXX010101000, régimen 616, uso S01, CP 26015.

COMPRADOR (tienda):
1. Agrega un producto al carrito.
2. Activa el botón: Tienda online → Temas → Personalizar → "Incrustaciones de la app" → activa "Flouvia" y enciende el botón flotante, en /cart y/o en tarjetas de producto → Guardar. (Alternativa: en Carrito o Producto → Agregar bloque → Apps → Solicitar cotización.)
3. Abre "Solicitar cotización". Paso 1 Productos (edita/quita ítems). Paso 2 Contacto (nombre, email, empresa, RFC, términos; campos extra en Pro). Paso 3 Revisar → envía. Aparece el folio (#D001).
4. En el admin, la cotización aparece con el badge "Desde la tienda".

---

## Screenshots — 1600 × 900 px
# Mínimo 3, recomendado 8. PNG o JPG.
# Herramientas sugeridas: Canva, Figma o ScreenStudio (hace capturas con marco de Mac).
# Estilo: fondo azul Flouvia #1a73e8 (o degradado a #4285f4), captura de pantalla centrada con
# sombra leve (~70% del área), texto blanco arriba o abajo (~30%).

---

### Screenshot 1 — Dashboard de Cotizaciones
Alt text (64 chars max):
Dashboard de cotizaciones con resumen de ventas B2B en Shopify

Headline para la imagen: "Todas tus cotizaciones en un solo lugar"
Subtext:               "Abiertas · Enviadas · Pagadas · Valor pendiente de cobro"

Qué mostrar:
- Ruta /app/quotes con al menos 5–6 cotizaciones en distintos estados (Nueva, Enviada, Pagada).
- El grid de 4 tarjetas de resumen visible en la parte superior (Total, Abiertas, Valor pipeline, Tasa).
- Filtros y barra de búsqueda visibles.
Cómo prepararlo:
1. Crea 6 cotizaciones de ejemplo desde /app/quotes/new.
2. Cambia manualmente el estado de algunas (aprueba una → aparece como Enviada; cierra una).
3. Captura con Cmd+Shift+4 en Mac.

---

### Screenshot 2 — Detalle de cotización (negociación de precios)
Alt text:
Edición de precios negociados y descuentos en una cotización B2B

Headline: "Negocia precios y cobra en minutos"
Subtext:  "Ajusta cada producto · Aplica descuentos · Manda el link por WhatsApp"

Qué mostrar:
- Ruta /app/quotes/:id con al menos 2–3 productos.
- Un precio de ítem diferente al original (para que se vea que se negoció).
- El campo de descuento con un valor (ej. 10%).
- Los botones "Abrir link de pago" y "Copiar link" visibles.
- Términos de crédito ya asignados (ej. Net 30).
Cómo prepararlo:
1. Crea una cotización con 3 productos.
2. Cambia el precio de uno de los ítems.
3. Pon un descuento del 10%.
4. Asigna términos Net 30.

---

### Screenshot 3 — Modal de 3 pasos (storefront — paso 1 Productos)
Alt text:
Modal de solicitud de cotización con carrito editable en la tienda

Headline: "El comprador pide la cotización solo"
Subtext:  "Sin WhatsApp · Sin llamadas · Directo desde tu tienda"

Qué mostrar:
- Tu tienda dev con el modal abierto en el Paso 1 (Productos).
- El stepper de 3 pasos visible arriba (1 Productos, 2 Contacto, 3 Revisar).
- Al menos 2 productos en la lista con sus controles −/+ y botón de quitar.
- El botón "Siguiente" visible en la parte inferior del modal.
Cómo prepararlo:
1. Activa la theme app extension en el editor de temas.
2. Agrega 2–3 productos al carrito de la tienda dev.
3. Da clic en "Solicitar cotización" para abrir el modal.
4. Captura con el fondo de la tienda visible (para que se vea el contexto).

---

### Screenshot 4 — Modal de 3 pasos (storefront — paso 2 Contacto, campos Pro)
Alt text:
Formulario B2B con empresa, RFC y términos de crédito en el modal

Headline: "Captura empresa, RFC y términos desde el primer contacto"
Subtext:  "Teléfono · Empresa · RFC · Net 30 / Net 60 — con Plan Pro"

Qué mostrar:
- El modal en el Paso 2 (Contacto) con TODOS los campos Pro visibles:
  Nombre, Email, Teléfono, Empresa, RFC, selector de Términos de crédito, Notas.
- El indicador de Plan Pro o simplemente los campos llenos.
- Validación de RFC en vivo activa (el campo verde si el RFC es válido).
Cómo prepararlo:
1. Con Plan Pro activo, ve a la tienda y abre el modal.
2. Llena todos los campos con datos de ejemplo.
3. Captura cuando el RFC esté validado (borde verde).

---

### Screenshot 5 — CFDI (Plan Pro)
Alt text:
Sección de datos fiscales CFDI para facturación electrónica en México

Headline: "Facturación CFDI integrada"
Subtext:  "RFC · Régimen fiscal · Uso CFDI · Genera el comprobante al cobrar"

Qué mostrar:
- La sección de datos fiscales en el detalle de una cotización (/app/quotes/:id).
- Campos llenos: RFC (con formato válido), Razón Social, Régimen Fiscal (selector SAT),
  Uso de CFDI (selector), CP Fiscal.
- El botón "Generar factura CFDI" visible.
- Si tienes un UUID de ejemplo: muéstralo como "CFDI timbrado: xxxx-xxxx-xxxx".
Cómo prepararlo:
1. Activa Plan Pro.
2. Abre una cotización y llena todos los campos fiscales con datos de prueba.
   RFC de ejemplo válido: XAXX010101000
3. Captura la sección completa.

---

### Screenshot 6 — Analítica (Plan Pro)
Alt text:
Analítica con ingresos, tasa de conversión y ticket promedio B2B

Headline: "Mide tus ingresos, pipeline y conversión"
Subtext:  "Últimos 7 / 30 / 90 días · Gráfica mensual · Top 5 clientes"

Qué mostrar:
- Ruta /app/analitica con Plan Pro activo.
- Las 4 tarjetas de KPIs: Ingresos cobrados, Pipeline, Conversión, Ticket promedio (con números reales).
- La gráfica de barras de los últimos 6 meses visible.
- El top 5 de clientes abajo.
- El filtro de rango seleccionado (ej. "Últimos 30 días").
Cómo prepararlo:
1. Necesitas al menos 8–10 cotizaciones con estados variados para que los KPIs no sean cero.
2. Crea cotizaciones en distintos días (cambia la fecha de tu Mac si hace falta para tener "meses anteriores").
3. Captura con el filtro "Todo el tiempo" si no tienes datos de múltiples meses.

---

### Screenshot 7 — Empresas B2B (Plan Pro)
Alt text:
Gestión de empresas B2B con límite de crédito y barra de uso

Headline: "Gestiona el crédito y el historial de cada empresa"
Subtext:  "Límite de crédito · Crédito en uso · Historial de cotizaciones"

Qué mostrar:
- Ruta /app/empresas con Plan Pro activo.
- Al menos 2–3 tarjetas de empresa con la barra de progreso de crédito visible.
- Una empresa con crédito parcialmente utilizado (barra azul a ~50–70%).
- Si puedes: el drawer lateral abierto con el detalle de una empresa (histórico + campo de límite).
Cómo prepararlo:
1. En Shopify admin crea al menos 2 empresas (Customers → Companies).
2. Asigna cotizaciones a esas empresas desde el detalle de cotización (campo Empresa).
3. Edita el límite de crédito desde el drawer para que la barra de progreso se vea llena.

---

### Screenshot 8 — Configuración
Alt text:
Configuración con datos fiscales, notificaciones y preview del botón

Headline: "Todo configurable desde un solo lugar"
Subtext:  "Datos fiscales del vendedor · Notificaciones · Botón personalizado"

Qué mostrar:
- Ruta /app/configuracion con los tabs visibles arriba: Datos fiscales CFDI, Notificaciones,
  Términos de crédito, Botón en tienda.
- El tab "Botón en tienda" activo mostrando la preview del botón con el color personalizado.
- O el tab "Términos de crédito" mostrando los toggles activos (Contado, Net 30, Net 60).
Cómo prepararlo:
1. Ve a /app/configuracion.
2. Selecciona el tab "Botón en tienda" y cambia el color para que la preview se vea viva.
3. Captura con los tabs claramente legibles.

---

### Screenshot 9 — Onboarding / Inicio (opcional pero recomendada)
Alt text:
Dashboard de bienvenida con guía de primeros pasos y plan activo

Headline: "Configuración guiada — lista en minutos"
Subtext:  "Primeros pasos · Plan activo · Actividad reciente"

Qué mostrar:
- Ruta /app (Inicio) con la barra de progreso de primeros pasos a ~50% completado.
- Las tarjetas de primeros pasos (algunos con ✅ y otros pendientes).
- La sección de plan activo con el nombre y fechas.
- La actividad reciente con las últimas 3–5 cotizaciones.
Cómo prepararlo:
1. Completa solo 2 de los 4 pasos del onboarding (ej. crear cotización + activar botón).
2. Captura con la barra en ~50% para que se vea el progreso.

---

### Screenshot 10 — PDF con tu marca (Plan Básico)
Alt text:
PDF de cotización descargable con logo, color de marca y datos fiscales

Headline: "Manda tu cotización en PDF con tu marca"
Subtext:  "Logo · Color de tu empresa · Datos de contacto · Pie personalizable"

Qué mostrar:
- El PDF generado de una cotización (botón "Descargar PDF" en /app/quotes/:id) con logo, color de marca y pie.
- O la pestaña "PDF" de /app/configuracion con la preview en vivo a la derecha.
Cómo prepararlo:
1. Activa Plan Básico o Pro.
2. Ve a /app/configuracion → pestaña PDF, sube tu logo y elige color.
3. Abre una cotización y da clic en "Descargar PDF"; captura la preview.

---

### Screenshot 11 — Formulario personalizable (Plan Pro)
Alt text:
Editor del formulario de cotización con campos personalizables B2B

Headline: "Personaliza el formulario de cotización"
Subtext:  "Activa o desactiva campos · Teléfono · Empresa · RFC · Términos"

Qué mostrar:
- Ruta /app/formulario con Plan Pro activo: los toggles de campos y la preview del modal.
Cómo prepararlo:
1. Activa Plan Pro.
2. Ve a /app/formulario y enciende/apaga algunos campos para que se vea el control.

---

### Screenshot 12 — Botón flotante y en tarjetas (storefront, opcional)
Alt text:
Botón Cotizar flotante y en cada tarjeta de producto en la tienda

Headline: "El botón aparece donde tus compradores lo necesitan"
Subtext:  "Carrito · Página de producto · Botón flotante · En cada tarjeta"

Qué mostrar:
- Tu tienda dev con el botón flotante visible y/o el botón "Cotizar" inyectado en las tarjetas de un carrusel.
Cómo prepararlo:
1. En el editor de temas → App embeds → activa Flouvia → enciende botón flotante y botón en tarjetas.
2. Captura la home o una colección con los botones visibles.

---

### Resumen de screenshots — orden recomendado

| # | Pantalla | Headline |
|---|---|---|
| 1 | Lista de cotizaciones + stats | "Todas tus cotizaciones en un solo lugar" |
| 2 | Detalle — negociación de precios | "Negocia precios y cobra en minutos" |
| 3 | Modal paso 1 — productos (storefront) | "El comprador pide la cotización solo" |
| 4 | Modal paso 2 — campos B2B Pro (storefront) | "Captura empresa, RFC y términos" |
| 5 | Sección CFDI | "Facturación CFDI integrada" |
| 6 | Analítica | "Mide ingresos, pipeline y conversión" |
| 7 | Empresas B2B | "Gestiona el crédito por empresa" |
| 8 | Configuración | "Todo configurable desde un solo lugar" |
| 9 | Onboarding / Inicio | "Lista en minutos" |
| 10 | PDF con tu marca | "Manda tu cotización en PDF con tu marca" |
| 11 | Formulario personalizable | "Personaliza el formulario de cotización" |
| 12 | Botón flotante y en tarjetas | "El botón aparece donde lo necesitan" |

Mínimo para publicar: screenshots 1, 2, 3, 4 y 5.

---

## Tips para todas las imágenes

- Dimensiones exactas: 1600 × 900 px.
- Fondo: azul Flouvia #1a73e8 degradado a #4285f4 (o blanco si prefieres limpio).
- La captura de pantalla ocupa ~70% del área centrada, con sombra leve.
- El texto (headline + subtext) va en el 30% superior o inferior.
- Fuente del texto: cualquier sans-serif — Inter, SF Pro, Helvetica.
- Herramientas:
  - Canva (gratis, tiene plantillas de screenshots de apps).
  - Figma (más control, usa "Device Mockup" plugin).
  - ScreenStudio (Mac, $29 único — hace automáticamente el marco de pantalla + sombra + fondo).
- Haz Cmd+Shift+4 en Mac para capturar solo la ventana.
- Sin testimonios ni calificaciones de estrellas (Shopify los prohíbe en screenshots).

---

## Video demo — guía paso a paso

### Especificaciones técnicas

| Campo | Requerimiento |
|---|---|
| Formato | MP4 (H.264) |
| Resolución | 1080p (1920×1080) recomendado; 720p mínimo |
| Duración | 60–90 segundos ideal; máximo ~3 minutos |
| Tamaño máximo | ~50 MB (comprime con HandBrake si pasas) |
| Relación | 16:9 |
| Audio | Opcional; si no hay voz, pon música suave de fondo (sin derechos) |

### Herramientas recomendadas para grabar y editar

| Herramienta | Para qué | Costo |
|---|---|---|
| QuickTime | Grabación de pantalla en Mac | Gratis |
| ScreenStudio | Grabación con zoom automático y marco bonito | $29 único |
| Descript | Editar el video, agregar textos en pantalla, recortar | Tier gratis |
| CapCut | Editar en Mac/PC, subtítulos automáticos, música | Gratis |
| HandBrake | Comprimir el MP4 final (CRF 23, preset Medium) | Gratis |
| Cursor Pro | Hace el cursor grande y visible en la grabación | $10 único |

---

### Configuración antes de grabar

1. **Pantalla:** resolución 1920×1080, zoom del navegador al 90%.
2. **Cursor:** activa `Cursor Pro` o usa `Accessibility Inspector` para agrandarlo.
3. **Notificaciones:** activa No Molestar en Mac (Configuración del sistema → Enfoque).
4. **Dev store:** ten listas estas pantallas en pestañas abiertas:
   - Admin de Shopify → Apps → Flouvia Cotizaciones B2B (en `/app`)
   - Ruta `/app/quotes` (lista de cotizaciones con al menos 5 ejemplos)
   - Ruta `/app/quotes/:id` (detalle con precios ya editados, empresa asignada, términos Net 30)
   - Ruta `/app/analitica` (con datos reales)
   - Tu tienda dev con el carrito lleno de 2–3 productos y el botón ya instalado
5. **Datos de ejemplo:** ten ya creadas 5–6 cotizaciones con distintos estados antes de grabar.

---

### Guión del video — flujo completo (~75 segundos)

Puedes grabar con o sin voz. Si grabas sin voz, en cada escena escribe el texto de pantalla que se indica. Pausa 1–2 segundos en cada elemento importante antes de hacer clic.

---

**[0:00–0:08] — Problema**

Sin app: muestra brevemente una hoja de cálculo con cotizaciones o una conversación de WhatsApp con pedidos (puede ser una imagen fija de 3 segundos).

Texto en pantalla: `"¿Sigues cotizando por WhatsApp y Excel?"`

Pausa 1 segundo. Corte directo a la siguiente escena.

---

**[0:08–0:20] — El comprador solicita desde la tienda**

Escena: tu tienda dev con el carrito abierto.

1. Muestra el carrito con 2–3 productos y el botón "Solicitar cotización" visible.
2. Da clic en el botón → se abre el modal.
3. Paso 1 (Productos): muestra la lista con cantidades editables, cambia una cantidad.
4. Da clic en "Siguiente".
5. Paso 2 (Contacto): llena Nombre, Email, Empresa, RFC, Términos "Net 30", Notas breve.
6. Da clic en "Siguiente".
7. Paso 3 (Revisar): enseña el resumen 2 segundos.
8. Da clic en "Enviar solicitud" → aparece la pantalla de confirmación con el folio.

Texto en pantalla: `"El comprador solicita desde tu tienda en 3 pasos"`

---

**[0:20–0:35] — El vendedor recibe y gestiona en el admin**

Escena: cambia a la pestaña del admin de Shopify (app en `/app/quotes`).

1. Muestra el banner "Nueva solicitud desde la tienda" en el dashboard.
2. Da clic en la cotización nueva → se abre el detalle.
3. Se ven los datos del comprador: empresa, RFC, términos Net 30.
4. Edita el precio de un producto (borra el precio y escribe uno negociado).
5. Agrega un descuento del 10%.
6. Da clic en "Guardar cambios".

Texto en pantalla: `"Negocia precios y descuentos en segundos"`

---

**[0:35–0:47] — Enviar el link de pago**

Continúa en el detalle de la cotización.

1. Da clic en "Enviar por email" (o "Copiar link de pago").
2. Si tienes el flujo de email: muestra el inbox de prueba con el email recibido (con el link de pago visible).
3. Regresa al dashboard → la cotización ahora tiene badge "Enviada".

Texto en pantalla: `"El comprador recibe el link de pago al instante"`

---

**[0:47–1:00] — CFDI y analítica (Plan Pro)**

Escena 1: en el detalle de la cotización, muestra la sección CFDI con los datos fiscales llenos y el botón "Generar factura CFDI".

Texto: `"Genera la factura CFDI automáticamente (Plan Pro)"`

Escena 2: ve rápido a `/app/analitica` — muestra las 4 tarjetas de KPIs con números reales.

Texto: `"Analítica de ingresos y conversión en tiempo real"`

---

**[1:00–1:10] — Cierre**

Pantalla final: logo Flouvia centrado sobre fondo azul degradado #1a73e8 → #4285f4.

Texto:
- Línea 1 (grande): `"Flouvia Cotizaciones B2B"`
- Línea 2 (mediana): `"Portal B2B para Shopify — Hecho para México"`
- Línea 3 (pequeña, abajo): `"7 días de prueba gratis · flouvia.com"`

Música: fade out suave al final.

---

### Checklist de edición del video

- [ ] Corte limpio entre cada escena (sin "ehhh" o pausas largas).
- [ ] Cursor siempre visible y moviéndose despacio.
- [ ] Texto en pantalla legible (mínimo 36px, blanco con sombra oscura o sobre fondo de color).
- [ ] No muestres URLs de túneles (`trycloudflare.com`, `ngrok.io`) — si aparecen, recórtalas.
- [ ] No muestres credenciales reales, API keys ni emails personales en pantalla.
- [ ] El video NO debe tener testimonios de usuarios ni calificaciones de estrellas (Shopify lo prohíbe).
- [ ] Tamaño final del MP4 < 50 MB. Si pasa: abre HandBrake → Video: H.264 → Quality CRF 23 → Preset Medium → "Start Encode".

---

## Checklist final antes de publicar

- [ ] `BILLING_TEST = false` en `app.plans.tsx` (ya no está en `app.tsx`)
- [ ] URL de producción real en `shopify.app.toml` (`application_url`) — no puede ser `example.com`
- [ ] App desplegada con `npm run deploy` (registra webhooks GDPR)
- [ ] `PRIVACY.md` hosteado en URL pública (https://flouvia.com/privacidad)
- [ ] `CONTACT_TO` configurado con correo real de soporte en `.env`
- [ ] `RESEND_FROM` con dominio verificado en Resend (producción)
- [ ] Credenciales Facturama sandbox probadas (o producción si ya tienes cuenta)
- [ ] Mínimo 3 screenshots subidas (recomendado 6+)
- [ ] Video demo subido
- [ ] Descripción larga revisada y pegada en el Partner Dashboard
- [ ] Pricing configurado con los 4 planes (Básico mensual/anual, Pro mensual/anual)
- [ ] Categoría y keywords asignadas
- [ ] URL de política de privacidad en el listing
- [ ] Test account y Testing instructions llenas para el revisor de Shopify
