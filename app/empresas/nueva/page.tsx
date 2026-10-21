import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { nuevaEmpresa } from "../../acciones-cuenta";
import { Formulario } from "../../formulario";

export const metadata = { title: "Nueva empresa · Contable-System" };

export default async function NuevaEmpresa() {
  await exigirUsuario();
  return (
    <main className="centro">
      <div className="tarjeta" style={{ width: "100%", maxWidth: 460 }}>
        <h1>Nueva empresa</h1>
        <p className="sub">Se crea con el catálogo de cuentas dominicano y tú como dueño.</p>
        <Formulario accion={nuevaEmpresa} boton="Crear empresa">
          <label>Nombre de la empresa<input name="empresa" required /></label>
          <label>RNC (opcional)<input name="rnc" inputMode="numeric" placeholder="9 dígitos" /></label>
        </Formulario>
        <p style={{ marginTop: 16 }}><Link href="/empresas">← Volver</Link></p>
      </div>
    </main>
  );
}
