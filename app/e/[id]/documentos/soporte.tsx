import { Formulario } from "@/app/formulario";
import { conEmpresa } from "@/lib/db";
import { TIPOS, verTamano } from "@/lib/documentos";
import { adjuntarDocumento, retirarDocumento } from "../acciones";

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });

// Documentos de soporte de un asiento, factura o cobro: lista, descarga y formulario para adjuntar.
export async function DocumentosSoporte({ empresaId, entidad, entidadId, puedeAdjuntar, retirables }: {
  empresaId: string; entidad: "asiento" | "factura" | "cobro" | "compra" | "pago"; entidadId: string; puedeAdjuntar: boolean; retirables: boolean;
}) {
  const documentos = await conEmpresa(empresaId, (tx) => tx<{ id: string; nombre: string; tipo: string; tamano: number; descripcion: string | null; subido_en: Date; quien: string | null }[]>`
    SELECT d.id, d.nombre, d.tipo, d.tamano, d.descripcion, d.subido_en, u.nombre AS quien
      FROM documentos d LEFT JOIN usuarios u ON u.id = d.subido_por
     WHERE d.entidad = ${entidad} AND d.entidad_id = ${entidadId} AND NOT d.eliminado ORDER BY d.subido_en`);
  return (
    <>
      <h2>Documentos de soporte</h2>
      {documentos.length > 0 ? (
        <div className="tabla-envoltura">
          <table>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td><a href={`/e/${empresaId}/documentos/${d.id}`} target="_blank" rel="noopener">{d.nombre}</a>{d.descripcion && <div className="sub" style={{ margin: 0 }}>{d.descripcion}</div>}</td>
                  <td>{TIPOS[d.tipo]} · {verTamano(d.tamano)}</td>
                  <td>{d.quien} · {fechaHora(d.subido_en)}</td>
                  <td className="num">
                    {retirables && puedeAdjuntar && (
                      <Formulario accion={retirarDocumento.bind(null, empresaId, d.id)} boton="Retirar" className="fila"><span /></Formulario>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="sub">Sin documentos adjuntos.</p>}
      {puedeAdjuntar && (
        <Formulario accion={adjuntarDocumento.bind(null, empresaId, entidad, entidadId)} boton="Adjuntar" className="fila">
          <label style={{ flex: "1 1 260px" }}>Archivo (PDF, JPG o PNG, hasta 4 MB)
            <input type="file" name="archivo" accept="application/pdf,image/jpeg,image/png" required />
          </label>
          <label style={{ flex: "1 1 220px" }}>Descripción (opcional)<input name="descripcion" placeholder="Orden de compra, contrato, comprobante de pago…" /></label>
        </Formulario>
      )}
    </>
  );
}
