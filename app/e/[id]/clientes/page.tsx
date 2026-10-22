import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarCliente } from "../ventas-acciones";

type Cliente = { id: string; nombre: string; rnc: string | null; email: string | null; telefono: string | null; direccion: string | null; dias_credito: number; activo: boolean; saldo: string };

export default async function Clientes({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string; q?: string }>;
}) {
  exigirModulo("ventas");
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const q = (sp.q ?? "").trim();
  const clientes = await conEmpresa(id, (tx) => tx<Cliente[]>`
    SELECT c.*, COALESCE((SELECT sum(s.saldo * f.tasa) FROM saldos_factura s JOIN facturas f ON f.id = s.factura_id
                           WHERE f.cliente_id = c.id AND NOT f.anulada), 0)::numeric(18,2)::text AS saldo
      FROM clientes c
     WHERE ${q} = '' OR c.nombre ILIKE ${"%" + q + "%"} OR c.rnc = ${q.replace(/-/g, "")}
     ORDER BY c.activo DESC, c.nombre`);
  const editable = puede(permisos, "registrar");
  const enEdicion = editable ? clientes.find((c) => c.id === sp.editar) : undefined;

  return (
    <>
      <h1>Clientes</h1>
      <p className="sub">Personas y empresas a las que les facturas. Para comprobantes de crédito fiscal (B01) el cliente necesita RNC o cédula.</p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo cliente"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarCliente.bind(null, id)} boton="Guardar cliente" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 260px" }}>Nombre o razón social<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label style={{ flex: "1 1 150px" }}>RNC o cédula<input name="rnc" inputMode="numeric" defaultValue={enEdicion?.rnc ?? ""} /></label>
            <label style={{ width: 130 }}>Días de crédito<input name="dias_credito" type="number" min={0} max={365} defaultValue={enEdicion?.dias_credito ?? 30} /></label>
            <label style={{ flex: "1 1 200px" }}>Correo<input name="email" type="email" defaultValue={enEdicion?.email ?? ""} /></label>
            <label style={{ flex: "1 1 150px" }}>Teléfono<input name="telefono" defaultValue={enEdicion?.telefono ?? ""} /></label>
            <label style={{ flex: "2 1 260px" }}>Dirección<input name="direccion" defaultValue={enEdicion?.direccion ?? ""} /></label>
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activo" defaultChecked={enEdicion.activo} style={{ minHeight: 0 }} /> Activo
              </label>
            )}
          </Formulario>
          {enEdicion && <p><Link href={`/e/${id}/clientes`}>Cancelar</Link></p>}
        </div>
      )}
      <form className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 260px" }}>Buscar<input name="q" defaultValue={q} placeholder="Nombre o RNC" /></label>
        <button>Buscar</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>RNC</th><th>Crédito</th><th className="num">Saldo (DOP)</th><th /></tr></thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                <td>{c.nombre}{!c.activo && " (inactivo)"}{c.email && <div className="sub" style={{ margin: 0 }}>{c.email}</div>}</td>
                <td>{c.rnc}</td>
                <td>{c.dias_credito ? `${c.dias_credito} días` : "Contado"}</td>
                <td className="num">{verMonto(c.saldo)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <Link href={`/e/${id}/cxc/estado?cliente=${c.id}`}>Estado de cuenta</Link>
                  {editable && <> · <Link href={`/e/${id}/clientes?editar=${c.id}`}>Editar</Link></>}
                </td>
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={5}>No hay clientes todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
