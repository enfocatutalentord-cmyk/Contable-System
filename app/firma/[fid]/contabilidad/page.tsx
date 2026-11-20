import Link from "next/link";
import { CampoRnc } from "@/app/campo-rnc";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { agregarEmpresaPropia, devolverAClientes, elegirQueFactura } from "../../contabilidad-acciones";

export const metadata = { title: "Contabilidad · Empire Tax & Legal" };

// Prioridad 1.1 del prompt de Patricia (20-nov-2026): sus empresas llevan contabilidad completa y no son clientes. Se agregan aquí,
// directo, o se pasan desde la lista de clientes sin perder nada. Solo para administradores de la firma.
export default async function Contabilidad({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid);
  const todas = await clientesDeFirma(fid, usuario.id, true, true);
  const propias = todas.filter((c) => c.propia);
  const clientes = todas.filter((c) => !c.propia);

  return (
    <>
      <h1>Contabilidad</h1>
      <p className="sub">
        Tus empresas llevan contabilidad completa: catálogo, asientos, facturación electrónica, cobros, cuentas por cobrar y por pagar,
        bancos, estados financieros y su propio 606, 607, 608 e IT-1. No salen en la lista de clientes. Se abren desde «Contabilidad» en el menú.
      </p>

      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Empresa</th><th>RNC</th><th>Factura a los clientes de la firma</th><th></th></tr></thead>
          <tbody>
            {propias.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/e/${p.id}`}>{p.nombre}</Link>{!p.activa && <span className="sub"> · inactiva</span>}</td>
                <td>{p.rnc ?? "—"}</td>
                <td>
                  {p.empire ? <strong>Sí (igualas, propuestas, cuentas por cobrar y presupuesto)</strong> : (
                    <Formulario accion={elegirQueFactura.bind(null, fid, p.id)} boton="Que facture esta" className="fila"><></></Formulario>
                  )}
                </td>
                <td>
                  {!p.empire && (
                    <Formulario accion={devolverAClientes.bind(null, fid, p.id)} boton="Devolver a clientes" className="fila"><></></Formulario>
                  )}
                </td>
              </tr>
            ))}
            {!propias.length && <tr><td colSpan={4}>Todavía no hay empresas en Contabilidad. Agrégalas abajo.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="tarjeta" style={{ maxWidth: 640, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Agregar una empresa nueva</h2>
        <p className="sub">Se crea con el catálogo de cuentas dominicano y la configuración tributaria sugerida.{!firma.empresa_propia_id && " La primera que agregues es la que factura a los clientes de la firma."}</p>
        <Formulario accion={agregarEmpresaPropia.bind(null, fid)} boton="Agregar a Contabilidad" className="formulario">
          <input type="hidden" name="modo" value="nueva" />
          <label>Razón social<input name="nombre" required placeholder="Ej.: Rojas Investment Group GR SRL" /></label>
          <CampoRnc etiqueta="RNC" name="rnc" requerido placeholder="9 dígitos" llena={{ nombre: "nombre" }} />
          {firma.empresa_propia_id && <label className="casilla"><input type="checkbox" name="factura" /> Es la que factura a los clientes de la firma</label>}
        </Formulario>
      </div>

      {clientes.length > 0 && (
        <div className="tarjeta" style={{ maxWidth: 640 }}>
          <h2 style={{ marginTop: 0 }}>Estaba como cliente</h2>
          <p className="sub">Si una de tus empresas está hoy en la lista de clientes, pásala aquí: conserva su ficha, sus documentos y todo lo registrado.</p>
          <Formulario accion={agregarEmpresaPropia.bind(null, fid)} boton="Pasar a Contabilidad" className="fila">
            <input type="hidden" name="modo" value="existente" />
            <select name="empresa" required aria-label="Empresa" defaultValue="" style={{ flex: "2 1 260px" }}>
              <option value="" disabled>Elige la empresa</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.rnc ? ` · ${c.rnc}` : ""}{c.activa ? "" : " (inactiva)"}</option>)}
            </select>
          </Formulario>
        </div>
      )}
    </>
  );
}
