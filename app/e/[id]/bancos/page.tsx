import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentasBancarias } from "@/lib/bancos";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarCuentaBancaria } from "../bancos-acciones";

export const metadata = { title: "Bancos · Empire Tax’N Legal" };

// Cuentas bancarias del cliente. Cada una se liga a su cuenta del catálogo y recibe los estados de cuenta del banco.
export default async function Bancos({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { bancos, cuentas } = await conEmpresa(id, async (tx) => {
    const bancos = await listarCuentasBancarias(tx);
    const usadas = new Set(bancos.map((b) => b.cuenta_id));
    // Cuentas de activo de detalle del grupo de efectivo (11…) que aún no son de un banco.
    const cuentas = (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa && c.tipo === "activo" && c.codigo.startsWith("11") && !usadas.has(c.id));
    return { bancos, cuentas };
  });
  const configura = puede(permisos, "catalogo");

  return (
    <>
      <h1>Bancos</h1>
      <p className="sub">
        Sube el estado de cuenta que da el banco (Excel, CSV u OFX) y concilia cada movimiento con lo registrado. Los
        movimientos repetidos no entran dos veces aunque el archivo se monte sobre otro.
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuenta</th><th>Cuenta contable</th><th>Último movimiento</th><th className="num">Saldo según banco</th><th className="num">Saldo en libros</th><th className="num">Por conciliar</th></tr></thead>
          <tbody>
            {bancos.map((b) => (
              <tr key={b.id} className={b.activa ? undefined : "anulado"}>
                <td>
                  <Link href={`/e/${id}/bancos/${b.id}`}><strong>{b.nombre}</strong></Link>
                  <div className="sub" style={{ margin: 0 }}>{b.banco}{b.numero && ` · ****${b.numero}`} · {b.moneda}{!b.activa && " · inactiva"}</div>
                </td>
                <td>{b.codigo} · {b.cuenta}</td>
                <td>{b.ultimo ? verFecha(b.ultimo) : "Sin importar"}</td>
                <td className="num">{b.moneda === "USD" && "US$ "}{verMonto(b.saldo_banco)}</td>
                <td className="num">{b.moneda === "USD" ? <span title="En pesos, como se contabiliza">RD$ {verMonto(b.saldo_libros)}</span> : verMonto(b.saldo_libros)}</td>
                <td className="num">{b.pendientes > 0 ? <strong>{b.pendientes}</strong> : "0"}</td>
              </tr>
            ))}
            {bancos.length === 0 && <tr><td colSpan={6}>Todavía no hay cuentas bancarias.{configura ? " Agrega la primera abajo." : ""}</td></tr>}
          </tbody>
        </table>
      </div>

      {configura && (
        <div className="tarjeta" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>Agregar cuenta bancaria</h2>
          {cuentas.length === 0 ? (
            <p className="aviso">No quedan cuentas de efectivo libres en el catálogo. Agrega una en <Link href={`/e/${id}/catalogo`}>Catálogo de cuentas</Link> (por ejemplo, 110105 Banco BHD).</p>
          ) : (
            <Formulario accion={guardarCuentaBancaria.bind(null, id, null)} boton="Agregar cuenta" className="fila">
              <label style={{ flex: "1 1 180px" }}>Banco<input name="banco" required maxLength={80} placeholder="Banco Popular" list="bancos-rd" /></label>
              <datalist id="bancos-rd">
                {["Banco Popular", "Banreservas", "Banco BHD", "Scotiabank", "Banco Santa Cruz", "Banco Promerica", "Banesco", "Banco Caribe", "Banco BDI", "Asociación Popular (APAP)", "Asociación Cibao", "Banco López de Haro", "Citibank", "Banco Vimenca", "Banco Ademi"].map((b) => <option key={b} value={b} />)}
              </datalist>
              <label style={{ flex: "1 1 180px" }}>Nombre<input name="nombre" required maxLength={80} placeholder="Popular corriente" /></label>
              <label style={{ flex: "0 1 120px" }}>Últimos 4 dígitos<input name="numero" inputMode="numeric" pattern="\d{4}" maxLength={4} /></label>
              <label style={{ flex: "0 1 110px" }}>Moneda
                <select name="moneda" defaultValue="DOP"><option value="DOP">Pesos</option><option value="USD">Dólares</option></select>
              </label>
              <label style={{ flex: "2 1 260px" }}>Cuenta del catálogo
                <select name="cuenta_id" required defaultValue="">
                  <option value="" disabled>Elige…</option>
                  {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </select>
              </label>
              <label style={{ flex: "0 1 170px" }}>Conciliar desde<input type="date" name="fecha_inicial" required defaultValue={`${hoyISO().slice(0, 8)}01`} /></label>
              <label style={{ flex: "0 1 170px" }}>Saldo del banco ese día<input name="saldo_inicial" inputMode="decimal" defaultValue="0.00" required /></label>
            </Formulario>
          )}
          <p className="sub" style={{ marginBottom: 0 }}>
            El saldo es el que muestra el estado de cuenta al empezar ese día (el saldo anterior). Lo anterior a esa fecha no se importa.
          </p>
        </div>
      )}
    </>
  );
}
