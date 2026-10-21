import Link from "next/link";
import { entrar } from "../acciones-cuenta";
import { Formulario } from "../formulario";

export const metadata = { title: "Entrar · Contable-System" };

export default function Entrar() {
  return (
    <main className="centro">
      <div className="tarjeta" style={{ width: "100%", maxWidth: 420 }}>
        <h1>Entrar</h1>
        <p className="sub">Contable-System</p>
        <Formulario accion={entrar} boton="Entrar">
          <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
          <label>Contraseña<input name="clave" type="password" autoComplete="current-password" required /></label>
        </Formulario>
        <p className="sub" style={{ marginTop: 16 }}>¿No tienes cuenta? <Link href="/registro">Crea una</Link></p>
      </div>
    </main>
  );
}
