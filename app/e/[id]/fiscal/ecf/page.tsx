import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hayLlave } from "@/lib/ecf-cifrado";
import { AMBIENTES } from "@/lib/ecf-dgii";
import { certificadosDeEmpresa } from "@/lib/ecf-emision";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { cambiarAmbiente, quitarCertificado } from "../../ecf-acciones";

// Factura electrónica con emisión propia: ambiente de la DGII (E2a) y los firmantes de la empresa, cada uno con su certificado (E3a).
export default async function FacturaElectronica({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { certs, ambiente } = await conEmpresa(id, async (tx) => ({
    certs: await certificadosDeEmpresa(tx),
    ambiente: (await tx<{ ecf_ambiente: string | null }[]>`SELECT ecf_ambiente FROM empresas WHERE id = ${id}`)[0].ecf_ambiente,
  }));
  const editable = puede(permisos, "empresa");
  const hoy = hoyISO();
  const faltan = (vence: string) => Math.round((Date.parse(vence) - Date.parse(hoy)) / 86_400_000);

  return (
    <>
      <p><Link href={`/e/${id}/fiscal`}>← Perfil fiscal</Link></p>
      <h1>Factura electrónica · emisión propia</h1>
      <p className="sub">
        El sistema arma cada e-CF en el formato de la DGII, lo firma con el certificado de quien lo emite y lo envía. En esta etapa genera el XML
        firmado de prueba y prueba la conexión; el envío real llega cuando la DGII acepte la conexión del servidor y certifique el sistema.
      </p>
      {!hayLlave() && (
        <p className="aviso">
          Falta la llave de cifrado <code>ECF_LLAVE</code> en Vercel. Sin ella los certificados no se pueden guardar. La pone quien administra Vercel
          (Settings › Environment Variables), como la clave de Gmail.
        </p>
      )}

      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Firmantes</h2>
        <p className="sub">
          Cada persona que firma tiene su propio certificado, como el rol de Firmante que la empresa delega en la Oficina Virtual de la DGII. Cada
          una lo sube en <Link href={`/e/${id}/certificado`}>Mi certificado</Link>. Quien no tiene uno firma con el principal, si su dueño lo comparte.
        </p>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Usuario</th><th>Titular del certificado</th><th>Identificación</th><th>Vence</th><th>Principal</th>{editable && <th />}</tr></thead>
            <tbody>
              {certs.map((c) => {
                const n = faltan(c.vence);
                return (
                  <tr key={c.id}>
                    <td>{c.usuario ?? "—"}</td>
                    <td>{c.titular}{c.emisor && <span className="sub"> · {c.emisor}</span>}</td>
                    <td>{c.identificacion ?? "—"}</td>
                    <td style={n <= 30 ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                      {verFecha(c.vence)}{n < 0 ? " · vencido" : n <= 60 ? ` · faltan ${n} días` : ""}
                    </td>
                    <td>{c.principal ? "Sí" : "—"}</td>
                    {editable && <td><Formulario accion={quitarCertificado.bind(null, id, c.id)} boton="Retirar" className="fila"><span /></Formulario></td>}
                  </tr>
                );
              })}
              {certs.length === 0 && <tr><td colSpan={editable ? 6 : 5}>Nadie ha subido su certificado en esta empresa.</td></tr>}
            </tbody>
          </table>
        </div>
        {editable && <p className="sub" style={{ margin: "8px 0 0" }}>Retira el de quien ya no firma por la empresa. Lo que ya se firmó con él queda registrado.</p>}
      </div>

      <div className="tarjeta" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Ambiente de la DGII</h2>
        <Formulario accion={cambiarAmbiente.bind(null, id)} boton={editable ? "Guardar" : ""} className="fila">
          <label style={{ flex: "1 1 320px" }}>Ambiente
            <select name="ambiente" defaultValue={ambiente ?? "testecf"} disabled={!editable}>
              {Object.entries(AMBIENTES).map(([k, v]) => <option key={k} value={k} disabled={k === "ecf"}>{v}{k === "ecf" ? " · cuando la DGII certifique el sistema" : ""}</option>)}
            </select>
          </label>
        </Formulario>
        <p className="sub">La prueba de conexión con la DGII está en <Link href={`/e/${id}/certificado`}>Mi certificado</Link>: usa el certificado de quien la hace.</p>
      </div>

      <p className="sub" style={{ marginTop: 16 }}>
        El XML firmado de prueba se genera desde cada factura en borrador (crédito fiscal, consumo de RD$250,000 o más y notas de crédito),
        con el siguiente número del rango electrónico cargado en <Link href={`/e/${id}/comprobantes`}>Comprobantes fiscales</Link>, sin tomarlo.
        Hoy: {verFecha(hoy)}.
      </p>
    </>
  );
}
