import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { plantillasDe } from "@/lib/mensajes-db";
import { ESTADOS_GESTION, leerFiltrosBitacora, listarGestiones, moverMes, nombreMes, ORIGENES, TIPOS_GESTION } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { equipoDe } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { anotarGestion, borrarGestion, cambiarEstadoGestion } from "../bitacora-acciones";

// Bitácora de gestiones del cliente (bloque 3a, Documento maestro, sección 8): lo que se hace por el cliente, a mano o solo.
export default async function Bitacora({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, usuario } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const f = leerFiltrosBitacora(sp, hoy);
  const equipo = await equipoDe(empresa.firma_id);
  const nombres = new Map(equipo.map((p) => [p.id, p.nombre]));
  const gestiones = await conEmpresa(id, (tx) => listarGestiones(tx, f, nombres));
  const registra = puede(permisos, "registrar");
  const consulta = (m: string) => `/e/${id}/bitacora?${new URLSearchParams({ ...f, mes: m }).toString()}`;
  const abiertas = gestiones.filter((g) => g.estado !== "hecha").length;
  // Mensajes de WhatsApp (bloque 3c): cualquiera de los predeterminados, con los datos de la ficha.
  const mensajes = puede(permisos, "exportar") && !(await soloCliente(empresa.firma_id, usuario.id))
    ? (await plantillasDe(empresa.firma_id)).filter((p) => !p.clave.startsWith("correo_")).map((p) => ({ clave: p.clave, nombre: p.nombre })) : [];

  return (
    <>
      <div className="entre">
        <div>
          <h1>Bitácora</h1>
          <p className="sub">
            Todo lo que se hace por {empresa.nombre}: lo que anota la coordinación y lo que el sistema registra solo (facturas emitidas,
            declaraciones presentadas, documentos procesados, notificaciones y mensajes de WhatsApp enviados). Sale en el reporte mensual del cliente.
          </p>
        </div>
        <div className="fila">
          <Link className="boton primario" href={`/e/${id}/bitacora/reporte?mes=${f.mes}`}>Reporte mensual</Link>
          {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/bitacora?mes=${f.mes}`} />}
        </div>
      </div>

      {mensajes.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Enviar un mensaje por WhatsApp</h2>
          <p className="sub" style={{ marginTop: 0 }}>Bienvenida, saludo de los lunes, requerimientos, citas… Se llena con los datos de la ficha y queda anotado aquí al enviarlo.</p>
          <EnviarWhatsApp empresaId={id} opciones={mensajes} etiqueta="Preparar mensaje" />
        </div>
      )}

      {registra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Anotar una gestión</h2>
          <Formulario accion={anotarGestion.bind(null, id)} boton="Anotar" className="fila">
            <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
            <label>Tipo
              <select name="tipo" defaultValue="tramite">
                {Object.entries(TIPOS_GESTION).filter(([k]) => k !== "factura" && k !== "documento").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "3 1 320px" }}>Qué se hizo<input name="descripcion" required maxLength={1000} placeholder="Ej.: Se gestionó la certificación de la DGII" /></label>
            <label>Responsable
              <select name="responsable" defaultValue={usuario.id}>
                {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label>Entrega<input type="date" name="entrega" /></label>
            <label>Estado
              <select name="estado" defaultValue="hecha">
                {Object.entries(ESTADOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 240px" }}>Soporte (PDF, JPG o PNG)<input type="file" name="archivo" accept="application/pdf,image/jpeg,image/png" /></label>
          </Formulario>
        </div>
      )}

      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={consulta(moverMes(f.mes, -1))}>← {nombreMes(moverMes(f.mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(f.mes)}</strong>
        <Link className="boton" href={consulta(moverMes(f.mes, 1))}>{nombreMes(moverMes(f.mes, 1))} →</Link>
      </nav>
      <form className="fila" style={{ marginBottom: 12 }} aria-label="Filtros">
        <input type="hidden" name="mes" value={f.mes} />
        <label>Tipo<select name="tipo" defaultValue={f.tipo}><option value="">Todos</option>{Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Estado<select name="estado" defaultValue={f.estado}><option value="">Todos</option>{Object.entries(ESTADOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Responsable<select name="responsable" defaultValue={f.responsable}><option value="">Todos</option>{equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <button>Filtrar</button>
      </form>
      <p className="sub">{gestiones.length} {gestiones.length === 1 ? "gestión" : "gestiones"} en el mes{abiertas ? ` · ${abiertas} sin terminar` : ""}.</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Qué se hizo</th><th>Responsable</th><th>Entrega</th><th>Estado</th>{registra && <th />}</tr></thead>
          <tbody>
            {gestiones.map((g) => (
              <tr key={g.id}>
                <td>{verFecha(g.fecha)}</td>
                <td>{TIPOS_GESTION[g.tipo]}<div className="sub" style={{ margin: 0 }}>{ORIGENES[g.origen]}</div></td>
                <td>{g.descripcion}{g.documento_id && <> · <a href={`/e/${id}/documentos/${g.documento_id}`} target="_blank" rel="noreferrer">soporte</a></>}</td>
                <td>{g.responsable ?? "—"}</td>
                <td style={g.entrega && g.entrega < hoy && g.estado !== "hecha" ? { color: "var(--peligro)" } : undefined}>{g.entrega ? verFecha(g.entrega) : "—"}</td>
                <td>{ESTADOS_GESTION[g.estado]}</td>
                {registra && (
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {g.estado !== "hecha" && <Formulario accion={cambiarEstadoGestion.bind(null, id, g.id, "hecha")} boton="Hecha" className="fila"><span /></Formulario>}
                    {g.estado === "pendiente" && <Formulario accion={cambiarEstadoGestion.bind(null, id, g.id, "en_proceso")} boton="En proceso" className="fila"><span /></Formulario>}
                    {g.origen === "manual" && <Formulario accion={borrarGestion.bind(null, id, g.id)} boton="Borrar" className="fila"><span /></Formulario>}
                  </td>
                )}
              </tr>
            ))}
            {gestiones.length === 0 && <tr><td colSpan={7}>No hay gestiones en este mes con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
