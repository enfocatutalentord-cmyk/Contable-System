import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { listarUnidades } from "@/lib/empresa-propia";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { esEmpresaPropia } from "@/lib/propia";
import { fechaValida, primerDiaMes, ultimoDiaMes } from "@/lib/reportes";
import { CATEGORIAS_PERSONALES, cuentasParaSalida, esTipoSalida, listarSalidas, TIPOS_SALIDA, totalesPorTipo, type TipoSalida } from "@/lib/salidas";
import { anularSalidaAccion, registrarSalidaAccion } from "../socia-acciones";
import { FormularioSalida } from "./formulario-salida";

const siguienteDia = (f: string) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// Registrar salidas (bloque 7a, Documento maestro sección 3): cada pago de la empresa propia a la cuenta que le toca.
export default async function Salidas({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  if (!(await esEmpresaPropia(id))) {
    return (<><h1>Registrar salidas</h1><p className="aviso">Las salidas y la cuenta de la socia son de la empresa propia de la firma. Elígela en «Empresas Empire › Empresa propia de la firma».</p></>);
  }
  const hoy = hoyISO();
  const desde = fechaValida(sp.desde) ? sp.desde : primerDiaMes(hoy);
  const hasta = fechaValida(sp.hasta) ? sp.hasta : ultimoDiaMes(hoy);
  const tipo = sp.tipo && esTipoSalida(sp.tipo) ? sp.tipo : null;
  const { cuentas, unidades, salidas } = await conEmpresa(id, async (tx) => ({
    cuentas: await cuentasParaSalida(tx), unidades: await listarUnidades(tx), salidas: await listarSalidas(tx, desde, hasta, tipo),
  }));
  const totales = totalesPorTipo(salidas);
  const registra = puede(permisos, "contabilizar");
  const anula = puede(permisos, "revertir");
  const filtros = `desde=${desde}&hasta=${hasta}${tipo ? `&tipo=${tipo}` : ""}`;

  return (
    <>
      <h1>Registrar salidas</h1>
      <p className="sub">
        Todo ingreso es de {empresa.nombre} y de ahí salen los gastos de la oficina y los personales. Cada salida va a la cuenta que le
        toca para que la contabilidad quede cuadrada y defendible: lo personal no es gasto, se carga a la cuenta corriente de la socia.
        Empire no le paga sueldo a la socia, así que esto no pasa por nómina.
      </p>
      {cuentas.socias.length === 0 && (
        <p className="aviso">No hay «Cuenta corriente – socia» en el catálogo. Registra a la socia en Ficha de la empresa › Socios y vuelve a preparar
          la empresa propia en Empresas Empire.</p>
      )}
      {registra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <FormularioSalida accion={registrarSalidaAccion.bind(null, id)} tipos={Object.entries(TIPOS_SALIDA) as [TipoSalida, { nombre: string; efecto: string }][]}
            efectivo={cuentas.efectivo} gastos={cuentas.gastos} socias={cuentas.socias} unidades={unidades} categorias={CATEGORIAS_PERSONALES}
            hoy={empresa.fecha_bloqueo && empresa.fecha_bloqueo >= hoy ? siguienteDia(empresa.fecha_bloqueo) : hoy}
            minimo={empresa.fecha_bloqueo ? siguienteDia(empresa.fecha_bloqueo) : undefined} />
        </div>
      )}

      <form className="fila" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
        <label>Tipo
          <select name="tipo" defaultValue={tipo ?? ""}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_SALIDA).map(([k, t]) => <option key={k} value={k}>{t.nombre}</option>)}
          </select>
        </label>
        <button>Ver</button>
        <Descargar href={`/e/${id}/exportar/salidas?${filtros}`} />
        <Link href={`/e/${id}/socia`}>Cuenta de la socia →</Link>
      </form>
      <p className="sub">
        {(Object.keys(TIPOS_SALIDA) as TipoSalida[]).filter((k) => totales[k] > 0n).map((k) => `${TIPOS_SALIDA[k].nombre}: RD$${verMonto(totales[k])}`).join(" · ") || "Sin salidas en el período."}
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Sale de</th><th>Va a</th><th className="num">Monto</th><th>Asiento</th>{anula && <th />}</tr></thead>
          <tbody>
            {salidas.map((s) => (
              <tr key={s.id} style={s.anulada ? { opacity: 0.6 } : undefined}>
                <td>{s.numero}</td>
                <td>{verFecha(s.fecha)}</td>
                <td>{TIPOS_SALIDA[s.tipo].nombre}</td>
                <td>{[s.categoria, s.acreedor, s.descripcion].filter(Boolean).join(" · ")}{s.anulada && <><br /><span className="error">Anulada: {s.motivo_anulacion}</span></>}</td>
                <td>{s.origen}</td>
                <td>{s.destino}</td>
                <td className="num">{verMonto(s.monto)}</td>
                <td><Link href={`/e/${id}/asientos/${s.asiento_id}`}>{s.asiento ? `n.º ${s.asiento}` : "Ver"}</Link></td>
                {anula && (
                  <td>
                    {!s.anulada && (
                      <details>
                        <summary>Anular</summary>
                        <Formulario accion={anularSalidaAccion.bind(null, id, s.id)} boton="Anular la salida" className="fila">
                          <label>Motivo<input name="motivo" required minLength={3} maxLength={300} /></label>
                        </Formulario>
                      </details>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {salidas.length === 0 && <tr><td colSpan={anula ? 9 : 8}>Sin salidas en el período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
