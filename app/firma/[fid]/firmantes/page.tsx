import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { certificadosDeEmpresa } from "@/lib/ecf-emision";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";

export const metadata = { title: "Firmantes de e-CF · Empire Tax’N Legal" };

// Firmantes de factura electrónica de todas las empresas (entrega E3a): quién tiene certificado en cada una, cuál es el principal,
// cuándo vence cada uno y qué usuarios del cliente con el rol «Cliente · Factura» todavía no tienen uno.
export default async function Firmantes({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const hoy = hoyISO();
  const empresas = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const ids = empresas.map((e) => e.id);
  // Usuarios del cliente que facturan desde el sistema.
  const facturan = ids.length ? await db()<{ empresa_id: string; usuario_id: string; nombre: string }[]>`
    SELECT m.empresa_id, u.id AS usuario_id, u.nombre FROM miembros m JOIN perfiles p ON p.id = m.perfil_id JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.empresa_id = ANY(${ids}::uuid[]) AND p.sistema AND p.nombre = 'Cliente · Factura' ORDER BY u.nombre` : [];
  const filas = (await Promise.all(empresas.map(async (e) => ({ e, certs: await conEmpresa(e.id, (tx) => certificadosDeEmpresa(tx)) }))))
    .map(({ e, certs }) => {
      const conCert = new Set(certs.map((c) => c.usuario_id));
      const principal = certs.some((c) => c.principal);
      return { e, certs, sinCert: facturan.filter((f) => f.empresa_id === e.id && !conCert.has(f.usuario_id) && !principal) };
    })
    .filter((f) => f.certs.length || f.sinCert.length);
  const faltan = (v: string) => Math.round((Date.parse(v) - Date.parse(hoy)) / 86_400_000);
  const porVencer = filas.flatMap((f) => f.certs).filter((c) => faltan(c.vence) <= 30).length;

  return (
    <>
      <h1>Firmantes de e-CF</h1>
      <p className="sub">
        Quién firma las facturas electrónicas de cada empresa, con qué certificado y cuándo vence. Cada certificado avisa en Alertas 30 días antes.
        {porVencer > 0 && ` ${porVencer} vence${porVencer > 1 ? "n" : ""} en 30 días o menos.`}
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Empresa</th><th>Usuario</th><th>Titular del certificado</th><th>Vence</th><th>Principal</th></tr></thead>
          <tbody>
            {filas.flatMap(({ e, certs, sinCert }) => [
              ...certs.map((c) => {
                const n = faltan(c.vence);
                return (
                  <tr key={c.id}>
                    <td><Link href={`/e/${e.id}/fiscal/ecf`}>{e.propia ? `${e.nombre} (Empire)` : e.nombre}</Link></td>
                    <td>{c.usuario ?? "—"}</td>
                    <td>{c.titular}{c.identificacion && <span className="sub"> · {c.identificacion}</span>}</td>
                    <td style={n <= 30 ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{verFecha(c.vence)}{n < 0 ? " · vencido" : n <= 30 ? ` · faltan ${n} días` : ""}</td>
                    <td>{c.principal ? "Sí" : "—"}</td>
                  </tr>
                );
              }),
              ...sinCert.map((s) => (
                <tr key={`${e.id}-${s.usuario_id}`}>
                  <td><Link href={`/e/${e.id}/fiscal/ecf`}>{e.nombre}</Link></td>
                  <td>{s.nombre}</td>
                  <td colSpan={3} className="sub">Factura desde el sistema pero no ha subido su certificado y la empresa no tiene principal.</td>
                </tr>
              )),
            ])}
            {filas.length === 0 && <tr><td colSpan={5}>Ninguna empresa tiene firmantes todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
