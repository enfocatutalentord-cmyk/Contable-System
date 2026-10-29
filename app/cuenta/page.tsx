import Link from "next/link";
import QRCode from "qrcode";
import { exigirUsuario } from "@/lib/auth";
import { estadoDosPasos } from "@/lib/cuenta-dos-pasos";
import { enlaceAutenticador } from "@/lib/dos-pasos";
import { verFecha } from "@/lib/montos";
import { cambiarClave } from "../acciones-cuenta";
import { Formulario } from "../formulario";
import { cancelarDosPasos, confirmarDosPasos, desactivarDosPasos, empezarDosPasos, nuevosCodigos } from "./acciones-dos-pasos";

export const metadata = { title: "Mi cuenta · Empire Tax’N Legal" };

// Solo dígitos, salvo donde también vale un código de recuperación (letras y guion).
const campoCodigo = (etiqueta = "Código de 6 dígitos de la app", recuperacion = false) => (
  <label>{etiqueta}<input name="codigo" inputMode={recuperacion ? "text" : "numeric"} autoComplete="one-time-code"
    pattern={recuperacion ? undefined : "[0-9 ]{6,7}"} maxLength={recuperacion ? 11 : 7} required /></label>
);

export default async function MiCuenta({ searchParams }: { searchParams: Promise<{ exigido?: string; desactivada?: string }> }) {
  const usuario = await exigirUsuario();
  const { exigido, desactivada } = await searchParams;
  const dp = await estadoDosPasos(usuario.id);
  const configurando = !dp.desde && dp.secreto;
  const qr = configurando ? await QRCode.toString(enlaceAutenticador(dp.secreto!, usuario.email), { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : "";

  return (
    <main className="centro">
      <div className="tarjeta" style={{ width: "100%", maxWidth: 560 }}>
        <h1>Mi cuenta</h1>
        <p className="sub">{usuario.nombre} · {usuario.email}</p>

        <h2 id="dos-pasos">Verificación en dos pasos</h2>
        {desactivada && !dp.desde && <p className="exito" role="status">Verificación en dos pasos desactivada. Al entrar solo se pide la contraseña.</p>}
        {exigido && !dp.desde && (
          <p className="error" role="alert">{dp.exigida.join(", ") || "Tu firma"} exige la verificación en dos pasos. Actívala para seguir trabajando.</p>
        )}
        {dp.desde ? (
          <>
            <p className="exito">Activa desde el {verFecha(dp.desde)}. Al entrar, después de la contraseña, se pide el código de tu app.</p>
            <p className="sub">
              Te quedan {dp.quedan} códigos de recuperación.{dp.quedan <= 3 && " Genera nuevos antes de que se acaben."}
              {dp.exigida.length > 0 && ` ${dp.exigida.join(", ")} la exige: no se puede desactivar.`}
            </p>
            <details>
              <summary>Generar códigos de recuperación nuevos</summary>
              <Formulario accion={nuevosCodigos} boton="Generar códigos nuevos">{campoCodigo()}</Formulario>
            </details>
            {dp.exigida.length === 0 && (
              <details>
                <summary>Desactivar la verificación en dos pasos</summary>
                <Formulario accion={desactivarDosPasos} boton="Desactivar">
                  <label>Contraseña<input name="clave" type="password" autoComplete="current-password" required /></label>
                  {campoCodigo("Código de la app o de recuperación", true)}
                </Formulario>
              </details>
            )}
          </>
        ) : configurando ? (
          <div className="configurando">
            <ol className="pasos">
              <li>Instala en tu celular una app de autenticación: Google Authenticator, Microsoft Authenticator o Authy (gratis).</li>
              <li>En la app toca <b>+</b> y escanea este código QR. Si no puedes escanearlo, escribe la clave a mano.</li>
              <li>Escribe abajo el código de 6 dígitos que aparece en la app.</li>
            </ol>
            <div className="qr-autenticador">
              <div dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="Código QR para la app de autenticación" />
              <div>
                <p className="sub" style={{ margin: 0 }}>Clave para escribir a mano</p>
                <p className="clave-manual" data-clave>{dp.secreto!.match(/.{1,4}/g)!.join(" ")}</p>
                <p className="sub">Cuenta: {usuario.email}<br />Tipo: según la hora</p>
              </div>
            </div>
            <Formulario accion={confirmarDosPasos} boton="Activar">{campoCodigo()}</Formulario>
            <Formulario accion={cancelarDosPasos} boton="" className="">
              <button className="enlace">Cancelar</button>
            </Formulario>
          </div>
        ) : (
          <>
            <p className="sub">
              Protege tu cuenta aunque alguien sepa tu contraseña: al entrar se pide también un código que cambia cada 30 segundos en
              una app de tu celular. Es lo que exige Xero a todos sus usuarios y lo que recomiendan OWASP y NIST.
            </p>
            <Formulario accion={empezarDosPasos} boton="Configurar verificación en dos pasos"><span /></Formulario>
          </>
        )}

        <h2>Cambiar contraseña</h2>
        <Formulario accion={cambiarClave} boton="Cambiar contraseña">
          <label>Contraseña actual<input name="actual" type="password" autoComplete="current-password" required /></label>
          <label>Nueva contraseña (mínimo 10 caracteres)<input name="nueva" type="password" autoComplete="new-password" minLength={10} required /></label>
        </Formulario>
        <p style={{ marginTop: 16 }}><Link href="/empresas">← Volver al sistema</Link></p>
      </div>
    </main>
  );
}
