# Política de Privacidad — Flouvia Cotizaciones B2B

_Última actualización: 7 de junio de 2026_

Esta política describe cómo la aplicación **Flouvia Cotizaciones B2B** ("la App", "nosotros") trata los datos personales de los comerciantes que la instalan y de sus clientes.

## 1. Responsable

- **Nombre:** Flouvia
- **Contacto:** hola@flouvia.com
- **Sitio web:** https://flouvia.com
- **Política de privacidad:** https://flouvia.com/privacidad

## 2. Qué datos tratamos

Para funcionar, la App accede (a través de la API de Shopify) a:

- **Datos de la tienda:** nombre de la tienda, dominio, correo del comerciante.
- **Datos de clientes/compradores:** nombre, correo electrónico y, cuando el comerciante los captura para facturación (CFDI), datos fiscales (RFC, razón social, régimen fiscal, uso de CFDI, código postal).
- **Datos de pedidos/cotizaciones:** productos, cantidades, precios y totales de las cotizaciones (Draft Orders).

La App **no almacena datos personales de clientes en su propia base de datos**; estos residen en Shopify. La App solo guarda **datos de sesión** del comerciante para autenticación.

## 3. Para qué usamos los datos

- Crear y gestionar cotizaciones B2B.
- Asignar el cliente o empresa a una cotización y generar el link de pago.
- Enviar avisos por correo al comerciante cuando llega una solicitud (Plan Pro).
- Generar facturas CFDI cuando el comerciante lo solicita (Plan Pro).

Usamos los datos **solo para estas finalidades** y la cantidad mínima necesaria.

## 4. Terceros con los que compartimos datos

- **Shopify** — plataforma donde se ejecuta la App y residen los datos.
- **Resend** ([resend.com](https://resend.com)) — envío de los correos de aviso al comerciante (Plan Pro).
- **Facturama** ([facturama.mx](https://facturama.mx)) — timbrado de facturas CFDI ante el SAT (Plan Pro), cuando el comerciante usa esa función.

No vendemos datos personales ni los usamos para publicidad.

## 5. Conservación

Conservamos los datos de sesión mientras la App esté instalada. Al desinstalar, Shopify nos notifica y **borramos los datos de la tienda** (incluidas las sesiones) conforme a los webhooks de cumplimiento (en un máximo de 48 horas).

## 6. Seguridad

- Toda la comunicación viaja cifrada por HTTPS.
- El acceso a la API está protegido con los tokens de Shopify.
- Las credenciales de servicios (Resend, Facturama) se guardan como variables de entorno, fuera del código.

## 7. Derechos de los titulares

Los clientes finales pueden ejercer sus derechos (acceso, rectificación, cancelación) **a través del comerciante**, quien es el responsable principal de sus datos. La App atiende las solicitudes de datos y borrado que Shopify envía (webhooks GDPR).

## 8. Cambios

Podemos actualizar esta política. Publicaremos la versión vigente en esta misma URL con su fecha.

## 9. Contacto

Para cualquier duda sobre privacidad: **hola@flouvia.com**
