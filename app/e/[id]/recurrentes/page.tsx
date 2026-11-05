import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { FRECUENCIAS } from "@/lib/igualas";
import { listarRecurrentes, prepararRecurrentes } from "@/lib/igualas-db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { eliminarRecurrente, guardarRecurrente, prepararAhora, prepararPendientes } from "../igualas-acciones";

// Facturas recurrentes (bloque 2b; Anexo A del manual: facturación a terceros por cuenta del cliente). Cada plantilla sale de una
// factura («Repetir esta factura») y prepara su borrador cuando toca, para revisarlo antes de enviar, como las repetidas de Xero.
export default async function Recurrentes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos, usuario } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const registra = puede(permisos, "registrar");
  const plantillas = await conEmpresa(id, async (tx) => {
    if (registra) await prepararRecurrentes(tx, { empresaId: id, usuarioId: usuario.id, hoy });
    return listarRecurrentes(tx);
  });

  return (
    <>
      <div className="entre">
        <div>
          <h1>Facturas recurrentes</h1>
          <p className="sub">
            Plantillas de facturas que se repiten (mensual, quincenal, trimestral, anual) o que se preparan a solicitud. Cuando toca,
            cada una prepara su borrador, que se revisa en Facturas antes de emitirlo. Para crear una, abre una factura y usa
            «Repetir esta factura».
          </p>
        </div>
        {registra && <Formulario accion={prepararPendientes.bind(null, id)} boton="Preparar lo que ya toca" className="fila"><span /></Formulario>}
      </div>
      {plantillas.length === 0 && <p className="aviso">Todavía no hay plantillas. Abre una factura de <Link href={`/e/${id}/facturas`}>Facturas</Link> y elige «Repetir esta factura».</p>}
      {plantillas.map((p) => (
        <div key={p.id} className="tarjeta" style={{ marginBottom: 12, opacity: p.activa ? 1 : 0.7 }}>
          <div className="entre">
            <div>
              <h2 style={{ margin: 0 }}>{p.nombre}{!p.activa && " (en pausa)"}</h2>
              <p className="sub" style={{ margin: 0 }}>
                {p.cliente} · {FRECUENCIAS[p.frecuencia]} · RD${verMonto(p.total)} sin impuestos
                {p.proxima && <> · próxima {verFecha(p.proxima)}</>}{p.hasta && <> · hasta {verFecha(p.hasta)}</>}
                {" · "}{p.lineas.length} {p.lineas.length === 1 ? "línea" : "líneas"}
              </p>
            </div>
          </div>
          {registra && (
            <div className="fila" style={{ marginTop: 8 }}>
              <Formulario accion={guardarRecurrente.bind(null, id, p.id)} boton="Guardar" className="fila">
                <input name="nombre" defaultValue={p.nombre} aria-label="Nombre" required maxLength={120} />
                <select name="frecuencia" defaultValue={p.frecuencia} aria-label="Frecuencia">
                  {Object.entries(FRECUENCIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label>Próxima<input type="date" name="proxima" defaultValue={p.proxima ?? ""} /></label>
                <label>Hasta<input type="date" name="hasta" defaultValue={p.hasta ?? ""} /></label>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" name="activa" defaultChecked={p.activa} style={{ minHeight: 0 }} /> Activa
                </label>
              </Formulario>
              {p.activa && <Formulario accion={prepararAhora.bind(null, id, p.id)} boton="Preparar ahora" className="fila"><span /></Formulario>}
              <Formulario accion={eliminarRecurrente.bind(null, id, p.id)} boton="Eliminar plantilla" className="fila"><span /></Formulario>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
