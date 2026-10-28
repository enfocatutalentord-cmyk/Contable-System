import Link from "next/link";
import { entrar } from "../acciones-cuenta";
import { Formulario } from "../formulario";
import { LogoCompleto } from "../marca";

export const metadata = { title: "Entrar · Empire Tax’N Legal" };

export default function Entrar() {
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <LogoCompleto />
        <div className="tarjeta">
          <h1>Entrar</h1>
          <p className="sub">Accede con el correo y la contraseña de tu usuario.</p>
          <Formulario accion={entrar} boton="Entrar">
            <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
            <label>Contraseña<input name="clave" type="password" autoComplete="current-password" required /></label>
          </Formulario>
          <p className="sub" style={{ marginTop: 16 }}><Link href="/recuperar">¿Olvidaste tu contraseña?</Link></p>
          <p className="sub">¿No tienes cuenta? <Link href="/registro">Crea una</Link></p>
        </div>
      </div>
    </main>
  );
}
