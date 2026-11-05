import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { TIPOS_ALERTA } from "@/lib/alertas";
import { alertasDeFirma, clientesDeFirma } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { EnviarWhatsApp } from "@/app/whatsapp";

export const metadata = { title: "Alertas · Empire Tax’N Legal" };

// Alertas de todos los clientes (bloque 3b, Documento maestro, sección 9): primero lo urgente. Se calculan con lo registrado y
// desaparecen solas cuando se resuelve lo que avisan.
export default async function Alertas({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ tipo?: string }>;
}) {
  const { fid } = await params;
  const { tipo } = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const todas = await alertasDeFirma(clientes, hoyISO());
  const filtro = tipo && tipo in TIPOS_ALERTA ? tipo : "";
  const visibles = filtro ? todas.filter((a) => a.tipo === filtro) : todas;
  const urgentes = todas.filter((a) => a.nivel === "urgente").length;
  const cuenta = (t: string) => todas.filter((a) => a.tipo === t).length;

  return (
    <>
      <h1>Alertas</h1>
      <p className="sub">
        Lo que vence o falta en cada cliente: comprobantes, declaraciones, notificaciones de pago, documentos, formalización, registro
        mercantil y ONAPI, contratos e igualas y fechas de fidelidad. Desaparecen solas cuando se resuelve lo que avisan.
        {" "}{todas.length ? `${todas.length} alerta${todas.length > 1 ? "s" : ""}${urgentes ? `, ${urgentes} urgente${urgentes > 1 ? "s" : ""}` : ""}.` : "No hay alertas."}
      </p>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Tipo">
        <Link className={`boton${!filtro ? " primario" : ""}`} href={`/firma/${fid}/alertas`}>Todas ({todas.length})</Link>
        {Object.entries(TIPOS_ALERTA).filter(([k]) => cuenta(k)).map(([k, v]) => (
          <Link key={k} className={`boton${filtro === k ? " primario" : ""}`} href={`/firma/${fid}/alertas?tipo=${k}`}>{v} ({cuenta(k)})</Link>
        ))}
      </nav>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Qué</th><th>Alerta</th><th>Mensaje</th></tr></thead>
          <tbody>
            {visibles.map((a, i) => (
              <tr key={i}>
                <td><strong>{a.cliente.nombre}</strong></td>
                <td>{TIPOS_ALERTA[a.tipo]}</td>
                <td style={a.nivel === "urgente" ? { color: "var(--peligro)", fontWeight: 600 } : undefined}><Link href={a.enlace}>{a.texto}</Link></td>
                <td>{a.mensaje && <EnviarWhatsApp empresaId={a.cliente.id} clave={a.mensaje.clave} docRef={a.mensaje.ref ?? null} extra={a.mensaje.extra} etiqueta="WhatsApp" />}</td>
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={4}>No hay alertas{filtro ? " de este tipo" : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
