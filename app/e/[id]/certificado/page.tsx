import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hayLlave } from "@/lib/ecf-cifrado";
import { certificadoActivo, miCertificado } from "@/lib/ecf-emision";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { compartirMiCertificado, probarConexionDgii, quitarCertificado, subirCertificado } from "../ecf-acciones";

export const metadata = { title: "Mi certificado" };

// «Mi certificado» (entrega E3a): cada persona que firma e-CF de esta empresa sube su propio certificado. La DGII delega el rol de
// Firmante en personas físicas, cada una con el suyo («Instructivo Delegaciones de Roles de Facturación Electrónica», v2.0).
export default async function MiCertificado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { usuario, empresa, permisos } = await accesoEmpresa(id);
  const { mio, principal } = await conEmpresa(id, async (tx) => ({ mio: await miCertificado(tx, usuario.id), principal: await certificadoActivo(tx) }));
  const puedeFirmar = puede(permisos, "contabilizar");
  const hoy = hoyISO();
  const faltan = mio ? Math.round((Date.parse(mio.vence) - Date.parse(hoy)) / 86_400_000) : null;
  const otroPrincipal = principal && principal.usuario_id !== usuario.id ? principal : null;

  return (
    <>
      <h1>Mi certificado</h1>
      <p className="sub">
        Tu certificado digital (.p12) para firmar las facturas electrónicas de {empresa.nombre}. Es personal: lo usa solo el sistema para firmar
        lo que tú emites, y nadie lo puede descargar. Antes, el administrador de la empresa tiene que delegarte el rol de <strong>Firmante</strong> en
        la Oficina Virtual de la DGII.
      </p>
      {!hayLlave() && (
        <p className="aviso">Todavía no se pueden guardar certificados: falta la llave de cifrado del sistema. Avísale a Empire.</p>
      )}

      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Tu certificado</h2>
        {mio ? (
          <>
            <dl>
              <dt>Titular</dt><dd>{mio.titular}</dd>
              {mio.identificacion && <><dt>Identificación</dt><dd>{mio.identificacion}</dd></>}
              {mio.emisor && <><dt>Emitido por</dt><dd>{mio.emisor}</dd></>}
              <dt>Vigencia</dt><dd>del {verFecha(mio.valido_desde)} al {verFecha(mio.vence)}</dd>
              <dt>Guardado</dt><dd>{mio.subido_en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</dd>
              <dt>Compartido</dt><dd>{mio.principal ? "Sí: es el principal de la empresa" : "No: solo firma lo que tú emites"}</dd>
            </dl>
            {faltan !== null && faltan <= 60 && (
              <p className="aviso">{faltan < 0 ? "Tu certificado venció: renuévalo y súbelo de nuevo." : `Tu certificado vence en ${faltan} días: pide la renovación.`}</p>
            )}
            {puedeFirmar && (
              <div className="fila" style={{ gap: 8 }}>
                {mio.principal
                  ? <Formulario accion={compartirMiCertificado.bind(null, id, false)} boton="Dejar de compartirlo" className="fila"><span /></Formulario>
                  : !otroPrincipal && <Formulario accion={compartirMiCertificado.bind(null, id, true)} boton="Compartirlo como principal" className="fila"><span /></Formulario>}
                <Formulario accion={quitarCertificado.bind(null, id, null)} boton="Retirar mi certificado" className="fila"><span /></Formulario>
              </div>
            )}
          </>
        ) : (
          <p className="sub">
            No has subido tu certificado.{" "}
            {otroPrincipal
              ? `Mientras tanto, lo que emitas se firma con el certificado principal de la empresa (${otroPrincipal.titular}), porque su dueño lo comparte.`
              : "Sin él no puedes firmar facturas electrónicas desde el sistema."}
          </p>
        )}
        {puedeFirmar ? (
          <details style={{ marginTop: 12 }} open={!mio || undefined}>
            <summary>{mio ? "Reemplazar mi certificado" : "Subir mi certificado"}</summary>
            <Formulario accion={subirCertificado.bind(null, id)} boton="Guardar mi certificado" className="fila">
              <label style={{ flex: "2 1 260px" }}>Archivo .p12<input type="file" name="certificado" accept=".p12,.pfx,application/x-pkcs12" required /></label>
              <label style={{ flex: "1 1 200px" }}>Contraseña del certificado<input type="password" name="clave" autoComplete="off" required /></label>
              {!mio && !otroPrincipal && (
                <label className="casilla" style={{ flex: "1 1 100%" }}>
                  <input type="checkbox" name="principal" value="1" /> Compartirlo como principal: los demás usuarios de esta empresa que no tengan uno propio firman con el mío
                </label>
              )}
            </Formulario>
            <p className="sub" style={{ margin: 0 }}>
              Súbelo solo aquí: nunca por chat, correo ni WhatsApp. La contraseña es la que llegó por correo al sacar el certificado.
            </p>
          </details>
        ) : <p className="sub">Tu rol no emite facturas en esta empresa, así que no necesitas certificado.</p>}
      </div>

      {puedeFirmar && (mio || otroPrincipal) && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Probar la conexión con la DGII</h2>
          <p className="sub">
            Pide una semilla a la DGII, la firma con {mio ? "tu certificado" : "el certificado principal"} y la cambia por un permiso de acceso. No envía facturas.
          </p>
          <Formulario accion={probarConexionDgii.bind(null, id)} boton="Probar la conexión" className="fila"><span /></Formulario>
        </div>
      )}

      {puede(permisos, "empresa") && (
        <p className="sub" style={{ marginTop: 16 }}>
          Todos los firmantes de la empresa y el ambiente de la DGII: <Link href={`/e/${id}/fiscal/ecf`}>Perfil fiscal › Factura electrónica</Link>.
        </p>
      )}
    </>
  );
}
