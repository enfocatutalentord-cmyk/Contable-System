import Link from "next/link";
import { pedirRecuperacion } from "../acciones-cuenta";
import { Formulario } from "../formulario";
import { LogoCompleto } from "../marca";

export const metadata = { title: "Olvidé mi contraseña · Empire Tax’N Legal" };

export default function Recuperar() {
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <LogoCompleto />
        <div className="tarjeta">
          <h1>¿Olvidaste tu contraseña?</h1>
          <p className="sub">Escribe tu correo y te enviamos un enlace para crear una nueva.</p>
          <Formulario accion={pedirRecuperacion} boton="Enviar enlace">
            <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
          </Formulario>
          <p className="sub" style={{ marginTop: 16 }}><Link href="/entrar">← Volver a entrar</Link></p>
        </div>
      </div>
    </main>
  );
}
