import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { cuentaBancaria } from "@/lib/bancos";
import { lineasPendientes } from "@/lib/conciliacion";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { deCentavos, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { puedeVer } from "@/lib/pestanas";
import { excluirMovimiento, registrarDesdeBanco } from "../../../../bancos-acciones";
import { conciliarMovimiento } from "../../../../bancos-acciones";
import { ElegirLineas } from "./elegir";

export const metadata = { title: "Conciliar movimiento · Empire Tax’N Legal" };

// Un movimiento del banco: buscar y combinar registros, registrarlo contra otra cuenta, registrar el cobro o el pago que
// falta, o excluirlo (por ejemplo, una línea repetida del banco).
export default async function Movimiento({ params }: { params: Promise<{ id: string; cid: string; mid: string }> }) {
  const { id, cid, mid } = await params;
  if (!esUuid(cid) || !esUuid(mid)) notFound();
  const { permisos, pestanas } = await accesoEmpresa(id);
  if (!puede(permisos, "contabilizar")) redirect(`/e/${id}/bancos/${cid}?sin_permiso=1`);
  const datos = await conEmpresa(id, async (tx) => {
    const [m] = await tx<{ fecha: string; descripcion: string; referencia: string | null; monto: string; estado: string }[]>`
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, descripcion, referencia, monto::text, estado
        FROM movimientos_banco WHERE id = ${mid} AND cuenta_bancaria_id = ${cid}`;
    if (!m) return null;
    const c = await cuentaBancaria(tx, cid);
    const entra = !m.monto.startsWith("-");
    const lineas = (await lineasPendientes(tx, cid)).filter((l) => l.monto !== null && (l.monto > 0n) === entra);
    const cuentas = (await listarCuentas(tx)).filter((x) => x.de_detalle && x.activa && x.id !== c.cuenta_id);
    return { m, c, lineas, cuentas };
  });
  if (!datos) notFound();
  const { m, c, lineas, cuentas } = datos;
  if (m.estado !== "pendiente") redirect(`/e/${id}/bancos/${cid}?estado=todos`);
  const entra = !m.monto.startsWith("-");
  const usd = c.moneda === "USD" ? "US$ " : "";
  const documento = entra ? puedeVer(pestanas, "/cobros") && "cobros" : puedeVer(pestanas, "/pagos") && "pagos";

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/bancos/${cid}`}>← {c.nombre}</Link></p>
      <h1>{entra ? "Entrada" : "Salida"} de {usd}{verMonto(m.monto.replace("-", ""))}</h1>
      <p className="sub">{verFecha(m.fecha)} · {m.descripcion}{m.referencia && ` · ref. ${m.referencia}`} · {c.nombre}</p>

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Buscar y combinar</h2>
        <p className="sub">Lo registrado en la cuenta {c.codigo} que aún no está conciliado. Marca uno o varios (por ejemplo, un depósito con tres cobros).</p>
        <ElegirLineas
          accion={conciliarMovimiento.bind(null, id, mid)}
          objetivo={m.monto}
          lineas={lineas.map((l) => ({
            id: l.id, fecha: l.fecha, monto: deCentavos(l.monto!),
            texto: `${l.documento ?? l.concepto} · asiento ${l.numero}${l.ref_doc || l.referencia ? ` · ref. ${l.ref_doc ?? l.referencia}` : ""}`,
          }))}
        />
      </div>

      {documento && (
        <div className="tarjeta" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>{entra ? "Registrar el cobro" : "Registrar el pago"}</h2>
          <p className="sub">
            Si es {entra ? "el cobro de una factura" : "el pago de una compra"} que todavía no se registró, regístralo con la fecha, la
            cuenta y la referencia de este movimiento; si el monto coincide, queda conciliado al guardarlo.
          </p>
          <Link className="boton primario" href={`/e/${id}/${documento}/nuevo?movimiento=${mid}`}>{entra ? "Registrar cobro" : "Registrar pago"}</Link>
        </div>
      )}

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Registrar contra otra cuenta</h2>
        <p className="sub">
          Para lo que no tiene documento: comisiones, impuesto a cheques y transferencias, intereses, o una transferencia entre
          cuentas propias (elige la cuenta del otro banco; cuando importes su estado de cuenta, se sugerirá solo). Se contabiliza
          un asiento con la fecha del movimiento.
        </p>
        <Formulario accion={registrarDesdeBanco.bind(null, id, mid)} boton="Registrar y conciliar" className="fila">
          <label style={{ flex: "2 1 260px" }}>Cuenta
            <select name="cuenta_id" required defaultValue="">
              <option value="" disabled>Elige…</option>
              {cuentas.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
            </select>
          </label>
          <label style={{ flex: "2 1 260px" }}>Concepto<input name="concepto" required maxLength={200} defaultValue={m.descripcion.slice(0, 200)} /></label>
          {c.moneda === "USD" && <label style={{ flex: "0 1 140px" }}>Tasa del dólar<input name="tasa" inputMode="decimal" required /></label>}
        </Formulario>
      </div>

      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Excluir</h2>
        <p className="sub">Solo si el movimiento no debe conciliarse (por ejemplo, una línea repetida o informativa del banco). Queda a la vista con el motivo.</p>
        <Formulario accion={excluirMovimiento.bind(null, id, mid)} boton="Excluir" className="fila">
          <label style={{ flex: "2 1 300px" }}>Motivo<input name="motivo" required maxLength={300} /></label>
        </Formulario>
      </div>
    </>
  );
}
