import Link from "next/link";
import { registrarse } from "../acciones-cuenta";
import { Formulario } from "../formulario";

export const metadata = { title: "Crear cuenta · Contable-System" };

export default function Registro() {
  return (
    <main className="centro">
      <div className="tarjeta" style={{ width: "100%", maxWidth: 460 }}>
        <h1>Crear cuenta de la firma</h1>
        <p className="sub">Registra tu firma contable. Después agregas a tus clientes y a tu equipo.</p>
        <Formulario accion={registrarse} boton="Crear cuenta">
          <label>Tu nombre<input name="nombre" autoComplete="name" required /></label>
          <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
          <label>Contraseña (mínimo 10 caracteres)<input name="clave" type="password" autoComplete="new-password" minLength={10} required /></label>
          <label>Nombre de la firma<input name="firma" required placeholder="Ej.: Empire Tax’N Legal" /></label>
          <label>RNC de la firma (opcional)<input name="rnc" inputMode="numeric" placeholder="9 dígitos" /></label>
        </Formulario>
        <p className="sub" style={{ marginTop: 16 }}>¿Ya tienes cuenta? <Link href="/entrar">Entra</Link></p>
      </div>
    </main>
  );
}
