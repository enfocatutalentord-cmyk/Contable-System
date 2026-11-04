import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { esUuid, exigirDuena } from "@/lib/acceso";
import { verFecha } from "@/lib/montos";
import { ACCIONES, detalleFirma, registrar, registroPlataforma } from "@/lib/plataforma";
import { reactivarFirma, suspenderFirma } from "../acciones";

export const metadata = { title: "Firma · Consola de la plataforma" };

const fecha = (d: Date | null) => (d ? verFecha(d.toISOString().slice(0, 10)) : "—");
const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Detalle de una firma: administradores y lista de clientes (nombre y RNC), suspender o reactivar, y su registro.
// Cada vez que se abre queda en el registro, porque muestra nombres y correos de la firma.
export default async function DetalleFirma({ params }: { params: Promise<{ fid: string }> }) {
  const usuario = await exigirDuena();
  const { fid } = await params;
  if (!esUuid(fid)) notFound();
  const d = await detalleFirma(fid);
  if (!d) notFound();
  await registrar(usuario, d.firma, "ver_firma");
  const registro = await registroPlataforma(fid);
  const { firma } = d;
  return (
    <main className="contenido">
      <p className="sub" style={{ marginBottom: 4 }}><Link href="/plataforma">← Consola de la plataforma</Link></p>
      <h1>{firma.nombre}</h1>
      <p className="sub">
        {firma.rnc ? `RNC ${firma.rnc} · ` : ""}alta el {fecha(firma.creada)} · {firma.clientes} cliente{firma.clientes === 1 ? "" : "s"} · {firma.personas} persona{firma.personas === 1 ? "" : "s"}
        {" · "}verificación en dos pasos {firma.exigir_dos_pasos ? "exigida" : "no exigida"} · última entrada {fecha(firma.ultima_entrada)}
      </p>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        {firma.suspendida_en ? (
          <>
            <h2 style={{ marginTop: 0 }}>Suspendida desde el {fecha(firma.suspendida_en)}</h2>
            <p>Motivo: {firma.suspendida_motivo}</p>
            <Formulario accion={reactivarFirma.bind(null, firma.id)} boton="Reactivar la firma">
              <label>Motivo de la reactivación<input name="motivo" required minLength={5} maxLength={300} /></label>
            </Formulario>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Suspender la firma</h2>
            <p className="sub">Nadie de la firma podrá entrar y verá un aviso con el correo de la plataforma. Sus datos no se borran y se puede reactivar.</p>
            <Formulario accion={suspenderFirma.bind(null, firma.id)} boton="Suspender la firma">
              <label>Motivo<input name="motivo" required minLength={5} maxLength={300} /></label>
            </Formulario>
          </>
        )}
      </section>

      <h2>Administradores</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Dos pasos</th></tr></thead>
          <tbody>
            {d.administradores.map((a) => <tr key={a.email}><td>{a.nombre}</td><td>{a.email}</td><td>{a.dos_pasos ? "Activa" : "No"}</td></tr>)}
            {!d.administradores.length && <tr><td colSpan={3} className="sub">Sin administradores.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Clientes</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Cliente</th><th>RNC</th><th>Estado</th></tr></thead>
          <tbody>
            {d.clientes.map((c, i) => <tr key={i}><td>{c.nombre}</td><td>{c.rnc ?? "—"}</td><td>{c.activa ? "Activo" : "Inactivo"}</td></tr>)}
            {!d.clientes.length && <tr><td colSpan={3} className="sub">Sin clientes.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Registro de esta firma</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Motivo</th></tr></thead>
          <tbody>
            {registro.map((r) => <tr key={r.id}><td>{fechaHora(r.en)}</td><td>{r.usuario_nombre}</td><td>{ACCIONES[r.accion] ?? r.accion}</td><td>{r.motivo ?? ""}</td></tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
