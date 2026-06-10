// Cifrado simétrico para secretos en reposo (la llave "live" de Facturapi de cada
// comerciante). Usa AES-256-GCM. La clave maestra vive en .env (NUNCA en git):
//
//   FACTURAPI_ENC_KEY=<64 caracteres hex = 32 bytes>
//   genera una con:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Formato del texto cifrado: "iv:authTag:datos" (todo en hex). El authTag de GCM
// detecta si el dato fue alterado al descifrar.

import crypto from "node:crypto";

const ALG = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.FACTURAPI_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "FACTURAPI_ENC_KEY falta o no mide 32 bytes (64 hex). Genera una con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Texto cifrado con formato inválido.");
  }
  const decipher = crypto.createDecipheriv(
    ALG,
    masterKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
