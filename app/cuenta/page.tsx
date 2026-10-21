import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { cambiarClave } from "../acciones-cuenta";
import { Formulario } from "../formulario";

export const metadata = { title: "Mi cuenta · Contable-System" };

export default async function MiCuenta() {
  const usuario = await exigirUsuario();
  return (
    <main className="centro">
      <div className="tarjeta" style={{ width: "100%", maxWidth: 440 }}>
        <h1>Mi cuenta</h1>
        <p className="sub">{usuario.nombre} · {usuario.email}</p>
        <h2>Cambiar contraseña</h2>
        <Formulario accion={cambiarClave} boton="Cambiar contraseña">
          <label>Contraseña actual<input name="actual" type="password" autoComplete="current-password" required /></label>
          <label>Nueva contraseña (mínimo 10 caracteres)<input name="nueva" type="password" autoComplete="new-password" minLength={10} required /></label>
        </Formulario>
        <p style={{ marginTop: 16 }}><Link href="/empresas">← Mis empresas</Link></p>
      </div>
    </main>
  );
}
