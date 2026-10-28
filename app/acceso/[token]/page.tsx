import Link from "next/link";
import { leerEnlace } from "@/lib/enlaces";
import { crearClaveConEnlace } from "../../acciones-cuenta";
import { Formulario } from "../../formulario";
import { LogoCompleto } from "../../marca";

export const metadata = { title: "Crear contraseña · Empire Tax’N Legal", robots: { index: false } };

// Página del enlace que llega por correo: verifica el correo y pide crear la contraseña antes de entrar.
// Solo mirar la página no gasta el enlace (algunos correos abren los enlaces para revisarlos); se gasta al guardar.
export default async function Acceso({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const enlace = await leerEnlace(token);
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <LogoCompleto />
        <div className="tarjeta">
          {enlace ? (
            <>
              <h1>{enlace.tipo === "invitacion" ? "Bienvenida al sistema" : "Nueva contraseña"}</h1>
              <p className="sub">
                Hola, {enlace.nombre}. {enlace.tipo === "invitacion" ? "Tu correo quedó verificado. " : ""}
                Crea tu contraseña para entrar con <b>{enlace.email}</b>.
              </p>
              <Formulario accion={crearClaveConEnlace.bind(null, token)} boton="Guardar contraseña y entrar">
                <input type="email" name="usuario" value={enlace.email} autoComplete="username" readOnly hidden />
                <label>Contraseña (mínimo 10 caracteres)<input name="clave" type="password" autoComplete="new-password" minLength={10} required /></label>
                <label>Repite la contraseña<input name="repetida" type="password" autoComplete="new-password" minLength={10} required /></label>
              </Formulario>
            </>
          ) : (
            <>
              <h1>Este enlace ya no sirve</h1>
              <p className="sub">Ya se usó o venció (las invitaciones duran 72 horas y los enlaces de nueva contraseña, 1 hora).</p>
              <p><Link href="/recuperar">Pedir un enlace nuevo</Link> o pídeselo al administrador de tu firma.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
