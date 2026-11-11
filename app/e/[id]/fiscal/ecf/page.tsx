import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hayLlave } from "@/lib/ecf-cifrado";
import { AMBIENTES } from "@/lib/ecf-dgii";
import { certificadoActivo } from "@/lib/ecf-emision";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { cambiarAmbiente, probarConexionDgii, quitarCertificado, subirCertificado } from "../../ecf-acciones";

// Factura electrónica con emisión propia (entrega E2a): certificado, ambiente de la DGII y prueba de conexión.
export default async function FacturaElectronica({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { cert, ambiente } = await conEmpresa(id, async (tx) => ({
    cert: await certificadoActivo(tx),
    ambiente: (await tx<{ ecf_ambiente: string | null }[]>`SELECT ecf_ambiente FROM empresas WHERE id = ${id}`)[0].ecf_ambiente,
  }));
  const editable = puede(permisos, "empresa");
  const hoy = hoyISO();
  const diasParaVencer = cert ? Math.round((Date.parse(cert.vence) - Date.parse(hoy)) / 86_400_000) : null;

  return (
    <>
      <p><Link href={`/e/${id}/fiscal`}>← Perfil fiscal</Link></p>
      <h1>Factura electrónica · emisión propia</h1>
      <p className="sub">
        El sistema arma cada e-CF en el formato de la DGII, lo firma con el certificado y lo envía. En esta etapa genera el XML firmado de
        prueba y prueba la conexión; el envío real llega cuando la DGII acepte la conexión del servidor y certifique el sistema.
      </p>
      {!hayLlave() && (
        <p className="aviso">
          Falta la llave de cifrado <code>ECF_LLAVE</code> en Vercel. Sin ella el certificado no se puede guardar. La pone quien administra Vercel
          (Settings › Environment Variables), como la clave de Gmail.
        </p>
      )}

      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Certificado digital</h2>
        {cert ? (
          <>
            <dl>
              <dt>Titular</dt><dd>{cert.titular}</dd>
              {cert.identificacion && <><dt>Identificación</dt><dd>{cert.identificacion}</dd></>}
              {cert.emisor && <><dt>Emitido por</dt><dd>{cert.emisor}</dd></>}
              <dt>Vigencia</dt><dd>del {verFecha(cert.valido_desde)} al {verFecha(cert.vence)}</dd>
              <dt>Guardado</dt><dd>{cert.subido_en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}{cert.subido_por && ` por ${cert.subido_por}`}</dd>
            </dl>
            {diasParaVencer !== null && diasParaVencer <= 60 && (
              <p className="aviso">{diasParaVencer < 0 ? "El certificado venció: renuévalo y súbelo de nuevo." : `El certificado vence en ${diasParaVencer} días: pide la renovación.`}</p>
            )}
            <p className="sub">Guardado cifrado. Nadie lo puede descargar desde el sistema; si cambia, se sube el nuevo y reemplaza a este.</p>
            {editable && <Formulario accion={quitarCertificado.bind(null, id)} boton="Retirar el certificado" className="fila"><span /></Formulario>}
          </>
        ) : <p className="sub">No hay certificado guardado.</p>}
        {editable && (
          <details style={{ marginTop: 12 }} open={!cert || undefined}>
            <summary>{cert ? "Reemplazar el certificado" : "Subir el certificado"}</summary>
            <Formulario accion={subirCertificado.bind(null, id)} boton="Guardar el certificado" className="fila">
              <label style={{ flex: "2 1 260px" }}>Archivo .p12<input type="file" name="certificado" accept=".p12,.pfx,application/x-pkcs12" required /></label>
              <label style={{ flex: "1 1 200px" }}>Contraseña del certificado<input type="password" name="clave" autoComplete="off" required /></label>
            </Formulario>
            <p className="sub" style={{ margin: 0 }}>
              Súbelo solo aquí: nunca por chat, correo ni WhatsApp. La contraseña es la que llegó por correo al sacar el certificado.
            </p>
          </details>
        )}
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
        {editable && cert && (
          <>
            <p className="sub">«Probar la conexión» pide una semilla a la DGII, la firma con el certificado y la cambia por un permiso de acceso. No envía facturas.</p>
            <Formulario accion={probarConexionDgii.bind(null, id)} boton="Probar la conexión con la DGII" className="fila"><span /></Formulario>
          </>
        )}
      </div>

      <p className="sub" style={{ marginTop: 16 }}>
        El XML firmado de prueba se genera desde cada factura en borrador (crédito fiscal, consumo de RD$250,000 o más y notas de crédito),
        con el siguiente número del rango electrónico cargado en <Link href={`/e/${id}/comprobantes`}>Comprobantes fiscales</Link>, sin tomarlo.
        Hoy: {verFecha(hoy)}.
      </p>
    </>
  );
}
