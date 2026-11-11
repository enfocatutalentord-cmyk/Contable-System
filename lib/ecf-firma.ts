// Firma de los XML para la DGII (entrega E2a), según el instructivo «Firmado de e-CF»: firma XMLDSig envuelta (enveloped) al final del
// documento, referencia con URI vacía, canonicalización C14N 2001, RSA-SHA256 y resumen SHA-256, con el certificado en X509Data.
// Una vez firmado, el XML no se puede alterar.
import { SignedXml } from "xml-crypto";

export const ALGORITMOS = {
  canonicalizacion: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  firma: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  resumen: "http://www.w3.org/2001/04/xmlenc#sha256",
  envuelta: "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
} as const;

export function firmarXml(xml: string, c: { llavePem: string; certBase64: string }): string {
  const sig = new SignedXml({
    privateKey: c.llavePem,
    signatureAlgorithm: ALGORITMOS.firma,
    canonicalizationAlgorithm: ALGORITMOS.canonicalizacion,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${c.certBase64}</X509Certificate></X509Data>`,
  });
  sig.addReference({ xpath: "/*", uri: "", isEmptyUri: true, digestAlgorithm: ALGORITMOS.resumen, transforms: [ALGORITMOS.envuelta] });
  sig.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  return sig.getSignedXml();
}

// Revisa la firma de un XML (para las pruebas y antes de guardar).
export function firmaValida(xmlFirmado: string, certPem: string): boolean {
  const sig = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  const m = /<Signature[\s\S]*<\/Signature>/.exec(xmlFirmado);
  if (!m) return false;
  sig.loadSignature(m[0]);
  try { return sig.checkSignature(xmlFirmado); } catch { return false; }
}

// Código de seguridad: los primeros seis caracteres del SignatureValue (Informe Técnico e-CF v1.0, representación impresa y QR).
export function codigoSeguridad(xmlFirmado: string): string {
  const m = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(xmlFirmado);
  if (!m) throw new Error("El XML no está firmado");
  return m[1].replace(/\s/g, "").slice(0, 6);
}
