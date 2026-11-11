// Lectura del certificado digital (.p12) para firmar e-CF (entrega E2a). Se usa la llave privada y el certificado del titular;
// el campo SN del certificado debe ser el RNC, la cédula o el pasaporte del titular (Descripción Técnica Servicios Emisores).
import forge from "node-forge";

export class ErrorCertificado extends Error {}

export type Certificado = {
  llavePem: string; certPem: string; certBase64: string;
  titular: string; identificacion: string | null; emisor: string | null; desde: string; vence: string;
};

const fecha = (d: Date) => d.toISOString().slice(0, 10);
const atributo = (a: forge.pki.CertificateField[], ...nombres: string[]) =>
  (a.find((x) => nombres.includes(x.name ?? "") || nombres.includes(x.shortName ?? "") || nombres.includes(x.type ?? ""))?.value as string | undefined) ?? null;

export function leerP12(bytes: Uint8Array, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(bytes).toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, clave);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/password|mac|invalid/i.test(m)) throw new ErrorCertificado("La contraseña del certificado no es correcta.");
    throw new ErrorCertificado("El archivo no es un certificado .p12 válido.");
  }
  const llaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].filter((b) => b.key);
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).filter((b) => b.cert);
  if (!llaves.length) throw new ErrorCertificado("El archivo no trae la llave privada: pide el .p12 completo a la entidad de certificación.");
  const llave = llaves[0].key as forge.pki.rsa.PrivateKey;
  // El certificado del titular es el que corresponde a la llave privada (el .p12 puede traer también la cadena de la entidad).
  const propio = certs.find((b) => {
    const pub = b.cert!.publicKey as forge.pki.rsa.PublicKey;
    return pub.n?.equals?.(llave.n);
  })?.cert ?? certs[0]?.cert;
  if (!propio) throw new ErrorCertificado("El archivo no trae el certificado del titular.");
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(propio)).getBytes();
  return {
    llavePem: forge.pki.privateKeyToPem(llave),
    certPem: forge.pki.certificateToPem(propio),
    certBase64: forge.util.encode64(der),
    titular: atributo(propio.subject.attributes, "commonName", "CN") ?? "Sin nombre",
    identificacion: atributo(propio.subject.attributes, "serialNumber", "2.5.4.5"),
    emisor: atributo(propio.issuer.attributes, "commonName", "CN"),
    desde: fecha(propio.validity.notBefore),
    vence: fecha(propio.validity.notAfter),
  };
}

// El certificado sirve si está vigente en la fecha dada.
export function vigente(c: Pick<Certificado, "desde" | "vence">, hoy: string): boolean {
  return c.desde <= hoy && hoy <= c.vence;
}
