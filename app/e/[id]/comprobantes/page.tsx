import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { COMPROBANTES, esElectronico, numeroComprobante } from "@/lib/fiscal";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { agregarSecuencia, desactivarSecuencia } from "../fiscal-acciones";

type Secuencia = { id: string; tipo: string; desde: string; hasta: string; siguiente: string; vence: string; activa: boolean };

const GRUPOS: [titulo: string, filtro: (t: string) => boolean][] = [
  ["Comprobantes fiscales (NCF)", (t) => !esElectronico(t)],
  ["Comprobantes fiscales electrónicos (e-CF)", esElectronico],
];

export default async function Comprobantes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos, empresa } = await accesoEmpresa(id);
  const { secuencias, emisorEcf } = await conEmpresa(id, async (tx) => ({
    secuencias: await tx<Secuencia[]>`
      SELECT id, tipo, desde::text, hasta::text, siguiente::text, to_char(vence, 'YYYY-MM-DD') AS vence, activa
        FROM secuencias_ncf ORDER BY tipo, desde`,
    emisorEcf: (await tx<{ emisor_ecf: boolean }[]>`SELECT emisor_ecf FROM empresas WHERE id = ${id}`)[0].emisor_ecf,
  }));
  const hoy = hoyISO();
  const editable = puede(permisos, "impuestos");
  const finDeAnio = `${Number(hoy.slice(0, 4)) + 1}-12-31`;
  const tipos = Object.keys(COMPROBANTES).filter((t) => emisorEcf || !esElectronico(t));

  return (
    <>
      <h1>Comprobantes fiscales</h1>
      <p className="sub">
        Los rangos que la DGII autorizó a {empresa.nombre} (Oficina Virtual, «Solicitud de comprobantes»). Cada documento toma el
        siguiente número del rango activo y vigente de su tipo.
        {!emisorEcf && <> Los tipos electrónicos (e-CF) aparecen al marcar la empresa como emisora electrónica en «Perfil fiscal».</>}
      </p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Agregar rango autorizado</h2>
          <Formulario accion={agregarSecuencia.bind(null, id)} boton="Agregar rango" className="fila">
            <label style={{ flex: "1 1 280px" }}>Tipo
              <select name="tipo" defaultValue="B01">
                {GRUPOS.map(([titulo, filtro]) => {
                  const del = tipos.filter(filtro);
                  return del.length ? (
                    <optgroup key={titulo} label={titulo}>
                      {del.map((t) => <option key={t} value={t}>{t} · {COMPROBANTES[t].nombre}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <label style={{ width: 150 }}>Desde<input name="desde" type="number" min={1} defaultValue={1} required /></label>
            <label style={{ width: 150 }}>Hasta<input name="hasta" type="number" min={1} max={9999999999} defaultValue={100} required /></label>
            <label>Vence<input name="vence" type="date" defaultValue={finDeAnio} required /></label>
          </Formulario>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Tipo</th><th>Rango</th><th>Próximo número</th><th className="num">Quedan</th><th>Vence</th><th>Estado</th>{editable && <th />}</tr></thead>
          <tbody>
            {secuencias.map((s) => {
              const quedan = Number(s.hasta) - Number(s.siguiente) + 1;
              const vencida = s.vence < hoy;
              const estado = !s.activa ? "Desactivado" : vencida ? "Vencido" : quedan <= 0 ? "Agotado" : quedan <= 10 ? "Quedan pocos" : "Disponible";
              return (
                <tr key={s.id}>
                  <td>{s.tipo} · {COMPROBANTES[s.tipo]?.nombre}</td>
                  <td>{numeroComprobante(s.tipo, s.desde)} – {numeroComprobante(s.tipo, s.hasta)}</td>
                  <td>{quedan > 0 ? numeroComprobante(s.tipo, s.siguiente) : "—"}</td>
                  <td className="num">{Math.max(0, quedan).toLocaleString("en-US")}</td>
                  <td>{verFecha(s.vence)}</td>
                  <td className={estado === "Disponible" ? undefined : "error"}>{estado}</td>
                  {editable && (
                    <td className="num">
                      {s.activa && (
                        <Formulario accion={desactivarSecuencia.bind(null, id)} boton="Desactivar" className="fila">
                          <input type="hidden" name="id" value={s.id} />
                        </Formulario>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {secuencias.length === 0 && <tr><td colSpan={7}>Todavía no hay rangos registrados.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Tipos de comprobante</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Tipo</th><th>Nombre</th><th>Se usa en</th><th>Para qué sirve</th><th>Equivalente</th></tr></thead>
          <tbody>
            {tipos.map((t) => (
              <tr key={t}>
                <td><strong>{t}</strong></td>
                <td>{COMPROBANTES[t].nombre}</td>
                <td>{COMPROBANTES[t].uso === "venta" ? "Ventas" : "Compras (lo emite el comprador)"}</td>
                <td>{COMPROBANTES[t].detalle}</td>
                <td>{COMPROBANTES[t].equivalente ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 12 }}>
        Fuente: DGII, Norma General 06-2018 sobre comprobantes fiscales, Norma General 05-19 y la guía de comprobantes fiscales
        electrónicos (e-NCF: E + tipo + 10 dígitos).
      </p>
    </>
  );
}
