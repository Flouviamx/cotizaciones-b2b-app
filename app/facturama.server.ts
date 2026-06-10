// Integración con Facturama (PAC) para timbrar CFDI 4.0.
//
// Lee credenciales desde .env (NO se suben a git):
//   FACTURAMA_USER=...          (usuario de tu cuenta Facturama)
//   FACTURAMA_PASSWORD=...      (contraseña)
//   FACTURAMA_CP=...            (código postal del emisor / lugar de expedición)
//   FACTURAMA_BASE_URL=https://apisandbox.facturama.mx   (sandbox por defecto)
//
// ⚠️ NO PROBADO en vivo todavía. La estructura del CFDI (impuestos, claves SAT,
// forma de pago) puede necesitar ajustes al probar contra el sandbox real.
// Claves SAT por defecto: ProductCode 01010101 (genérica), UnitCode H87 (Pieza),
// IVA 16% trasladado. Idealmente cada producto tendría su clave SAT real.

const BASE = process.env.FACTURAMA_BASE_URL || "https://apisandbox.facturama.mx";

function authHeader(): string | null {
  const user = process.env.FACTURAMA_USER;
  const pass = process.env.FACTURAMA_PASSWORD;
  if (!user || !pass) return null;
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

export type CfdiResult = { ok: boolean; uuid?: string; error?: string };

type TimbrarOpts = {
  receiver: {
    rfc: string;
    name: string;
    cfdiUse: string;
    fiscalRegime: string;
    taxZipCode: string;
  };
  expeditionPlace: string;
  items: { description: string; quantity: number; unitPrice: number }[];
};

export async function timbrarCFDI(opts: TimbrarOpts): Promise<CfdiResult> {
  const auth = authHeader();
  if (!auth) {
    return {
      ok: false,
      error:
        "Faltan credenciales de Facturama en .env (FACTURAMA_USER / FACTURAMA_PASSWORD).",
    };
  }

  const IVA = 0.16;
  const items = opts.items.map((it) => {
    const subtotal = Number((it.unitPrice * it.quantity).toFixed(2));
    const ivaAmount = Number((subtotal * IVA).toFixed(2));
    const total = Number((subtotal + ivaAmount).toFixed(2));
    return {
      ProductCode: "01010101", // clave producto/servicio SAT (genérica)
      UnitCode: "H87", // clave unidad SAT: Pieza
      Unit: "Pieza",
      Description: it.description,
      Quantity: it.quantity,
      UnitPrice: it.unitPrice,
      Subtotal: subtotal,
      TaxObject: "02", // 02 = sí objeto de impuesto
      Total: total,
      Taxes: [
        {
          Total: ivaAmount,
          Name: "IVA",
          Base: subtotal,
          Rate: IVA,
          IsRetention: false,
        },
      ],
    };
  });

  const body = {
    Currency: "MXN",
    CfdiType: "I", // Ingreso
    PaymentForm: "03", // Transferencia electrónica (ajustar según el pago real)
    PaymentMethod: "PUE", // Pago en una sola exhibición
    ExpeditionPlace: opts.expeditionPlace,
    Receiver: {
      Rfc: opts.receiver.rfc,
      Name: opts.receiver.name,
      CfdiUse: opts.receiver.cfdiUse,
      FiscalRegime: opts.receiver.fiscalRegime,
      TaxZipCode: opts.receiver.taxZipCode,
    },
    Items: items,
  };

  try {
    const res = await fetch(`${BASE}/3/cfdis`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (!res.ok) {
      const msg =
        data?.Message ||
        data?.ModelState ||
        JSON.stringify(data).slice(0, 250);
      return { ok: false, error: typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 250) };
    }
    const uuid = data?.Complement?.TaxStamp?.Uuid || data?.Uuid;
    return { ok: true, uuid };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Error de conexión con Facturama" };
  }
}
