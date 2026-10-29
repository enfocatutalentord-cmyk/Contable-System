import Link from "next/link";
import { redirect } from "next/navigation";
import { entradaPendiente } from "@/lib/auth";
import { verificarEntrada } from "../../acciones-cuenta";
import { Formulario } from "../../formulario";
import { LogoCompleto } from "../../marca";

export const metadata = { title: "Código de verificación · Empire Tax’N Legal" };

export default async function Codigo() {
  const p = await entradaPendiente();
  if (!p) redirect("/entrar");
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <LogoCompleto />
        <div className="tarjeta">
          <h1>Verificación en dos pasos</h1>
          <p className="sub">Hola, {p.nombre}. Abre tu app de autenticación y escribe el código de 6 dígitos de Empire Tax’N Legal.</p>
          <Formulario accion={verificarEntrada} boton="Verificar">
            <label>Código<input name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={11} autoFocus required /></label>
          </Formulario>
          <p className="sub" style={{ marginTop: 16 }}>
            ¿No tienes el celular? Escribe uno de tus códigos de recuperación (por ejemplo, abcde-23456).
            Si tampoco los tienes, pide al administrador de tu firma que te quite la verificación desde Personas y accesos.
          </p>
          <p className="sub"><Link href="/entrar">← Entrar con otra cuenta</Link></p>
        </div>
      </div>
    </main>
  );
}
