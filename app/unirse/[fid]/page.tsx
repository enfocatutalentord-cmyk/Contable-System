import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/acceso";
import { db } from "@/lib/db";
import { Formulario } from "../../formulario";
import { LogoCompleto } from "../../marca";
import { crearCuentaProspecto } from "../acciones";

export const metadata = { title: "Crear mi cuenta · Empire Tax’N Legal", robots: { index: false } };

// Página pública de registro de la firma (bloque 8a): quien se registra queda como prospecto y puede pedir servicios, llenar sus
// formularios y subir documentos. La firma la abre o la cierra en Clientes de la firma › Datos de la firma.
export default async function Unirse({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  if (!esUuid(fid)) notFound();
  const [f] = await db()<{ nombre: string; alta_clientes: boolean; suspendida: boolean }[]>`
    SELECT nombre, alta_clientes, suspendida_en IS NOT NULL AS suspendida FROM firmas WHERE id = ${fid}`;
  if (!f) notFound();
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 480 }}>
        <LogoCompleto />
        <div className="tarjeta">
          <h1>Crear mi cuenta en {f.nombre}</h1>
          {!f.alta_clientes || f.suspendida ? (
            <p className="aviso">El registro en línea no está abierto en este momento. Escríbenos por WhatsApp y te ayudamos.</p>
          ) : (
            <>
              <p className="sub">
                Con tu cuenta puedes pedir servicios, llenar tus formularios, subir tus documentos y ver cómo va cada solicitud. Te
                enviaremos un correo para verificarlo y crear tu contraseña.
              </p>
              <Formulario accion={crearCuentaProspecto.bind(null, fid)} boton="Crear mi cuenta">
                <label>Tu nombre<input name="nombre" autoComplete="name" required maxLength={120} /></label>
                <label>Correo<input name="email" type="email" autoComplete="email" required maxLength={200} /></label>
                <label>Teléfono o WhatsApp<input name="telefono" type="tel" autoComplete="tel" inputMode="tel" required placeholder="809-555-0000" /></label>
                <label>Nombre de tu negocio o empresa (opcional)<input name="negocio" maxLength={200} placeholder="Si lo dejas en blanco, usamos tu nombre" /></label>
                <label>RNC o cédula (opcional)<input name="identificacion" inputMode="numeric" placeholder="9 u 11 dígitos" /></label>
                <label style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <input type="checkbox" name="acepto" required style={{ minHeight: 0, marginTop: 4 }} />
                  <span className="sub">Acepto que {f.nombre} guarde estos datos para atenderme y contactarme (Ley 172-13 de protección de datos).</span>
                </label>
              </Formulario>
            </>
          )}
          <p className="sub" style={{ marginTop: 16 }}>¿Ya tienes cuenta? <Link href="/entrar">Entra</Link></p>
        </div>
      </div>
    </main>
  );
}
