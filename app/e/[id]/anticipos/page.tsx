import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { FORMAS_ANTICIPO, listarAnticipos } from "@/lib/anticipos";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { hoyISO, leerMonto, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { anularAnticipoAccion, registrarAnticipoAccion } from "../propuestas-acciones";

// Anticipos de clientes (bloque 2c): se cobran antes de facturar y quedan en «Anticipos de clientes» (210501) hasta aplicarlos a la
// factura (desde la factura: «Aplicar anticipo»). Con trueque, lo recibido va a la cuenta que se elija.
export default async function Anticipos({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ propuesta?: string; cliente?: string; monto?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const { anticipos, clientes, bancos, permuta, propuestas } = await conEmpresa(id, async (tx) => {
    const cuentas = (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa);
    return {
      anticipos: await listarAnticipos(tx),
      clientes: await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM clientes WHERE activo ORDER BY nombre`,
      bancos: cuentas.filter((c) => c.codigo.startsWith("1101")),
      permuta: cuentas.filter((c) => ["gasto", "costo", "activo"].includes(c.tipo) && !c.codigo.startsWith("1101") && !c.codigo.startsWith("1102")),
      propuestas: await tx<{ id: string; numero: number; cliente: string }[]>`
        SELECT p.id, p.numero, c.nombre AS cliente FROM propuestas p JOIN clientes c ON c.id = p.cliente_id
         WHERE p.estado IN ('borrador', 'enviada', 'aceptada') ORDER BY p.numero DESC LIMIT 100`,
    };
  });
  const cobra = puede(permisos, "contabilizar");
  const monto = sp.monto && leerMonto(sp.monto) ? sp.monto : "";
  const saldoTotal = anticipos.filter((a) => !a.anulado).reduce((s, a) => s + Number(a.saldo), 0);

  return (
    <>
      <h1>Anticipos de clientes</h1>
      <p className="sub">
        Lo que un cliente paga antes de la factura (por ejemplo el 60 % de una propuesta). Entra al banco contra «Anticipos de clientes»
        y se aplica a la factura cuando se emite, desde la factura misma. Saldo por aplicar: RD${verMonto(saldoTotal)}.
      </p>
      {cobra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Registrar anticipo</h2>
          <Formulario accion={registrarAnticipoAccion.bind(null, id)} boton="Registrar anticipo" className="fila">
            <label style={{ flex: "2 1 220px" }}>Cliente
              <select name="cliente" defaultValue={sp.cliente && esUuid(sp.cliente) ? sp.cliente : ""} required>
                <option value="" disabled>Elige el cliente…</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
            <label style={{ width: 150 }}>Monto<input name="monto" inputMode="decimal" defaultValue={monto} required /></label>
            <label>Forma de pago
              <select name="forma_pago" defaultValue="transferencia">
                {Object.entries(FORMAS_ANTICIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 260px" }}>Entró a (o, con trueque, lo recibido va a)
              <select name="cuenta_destino" defaultValue={bancos.find((c) => c.codigo === "110103")?.id ?? ""} required>
                <optgroup label="Banco o caja">
                  {bancos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </optgroup>
                <optgroup label="Trueque: gasto o activo recibido">
                  {permuta.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </optgroup>
              </select>
            </label>
            <label style={{ flex: "1 1 160px" }}>Referencia<input name="referencia" placeholder="N.º de transferencia o cheque" /></label>
            <label style={{ flex: "1 1 200px" }}>Propuesta
              <select name="propuesta" defaultValue={sp.propuesta && esUuid(sp.propuesta) ? sp.propuesta : ""}>
                <option value="">Sin propuesta</option>
                {propuestas.map((p) => <option key={p.id} value={p.id}>N.º {p.numero} · {p.cliente}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 100%" }}>Notas<input name="notas" /></label>
          </Formulario>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>N.º</th><th>Cliente</th><th>Fecha</th><th>Forma</th><th className="num">Monto</th><th className="num">Aplicado</th><th className="num">Saldo</th><th /></tr></thead>
          <tbody>
            {anticipos.map((a) => (
              <tr key={a.id} style={a.anulado ? { opacity: 0.55 } : undefined}>
                <td>{a.numero}{a.anulado && " (anulado)"}</td>
                <td>{a.cliente}{a.propuesta && <div className="sub" style={{ margin: 0 }}>Propuesta n.º {a.propuesta}</div>}</td>
                <td>{verFecha(a.fecha)}</td>
                <td>{FORMAS_ANTICIPO[a.forma_pago]}{a.referencia && <div className="sub" style={{ margin: 0 }}>{a.referencia}</div>}</td>
                <td className="num">{verMonto(a.monto)}</td>
                <td className="num">{verMonto(a.aplicado, true) || "—"}</td>
                <td className="num">{a.anulado ? "—" : verMonto(a.saldo)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {puede(permisos, "exportar") && <a href={`/e/${id}/exportar/recibo-anticipo?id=${a.id}&formato=pdf`}>Recibo PDF</a>}
                  {!a.anulado && Number(a.aplicado) === 0 && puede(permisos, "revertir") && (
                    <details style={{ display: "inline-block", marginLeft: 8 }}>
                      <summary>Anular</summary>
                      <Formulario accion={anularAnticipoAccion.bind(null, id, a.id)} boton="Anular anticipo" className="fila">
                        <input name="motivo" placeholder="Motivo" required aria-label="Motivo" />
                      </Formulario>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {anticipos.length === 0 && <tr><td colSpan={8}>Todavía no hay anticipos. <Link href={`/e/${id}/propuestas`}>Desde una propuesta</Link> se registra con el monto ya calculado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
