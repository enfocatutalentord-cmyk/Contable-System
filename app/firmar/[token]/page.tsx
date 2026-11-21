import { headers } from "next/headers";
import { LogoCompleto } from "../../marca";
import { marcarVista, porToken } from "@/lib/firma-digital";
import { FirmaForm } from "./firma-form";

export const metadata = { title: "Firmar un documento · Empire Tax & Legal", robots: { index: false, follow: false } };

const fecha = (d: Date | string | null) => (d ? new Date(d).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "long", timeStyle: "short" }) : "");

// Firma de un documento (Prioridad 3, P3e): la abre el cliente desde el enlace que le llegó por WhatsApp, sin cuenta y desde el celular. Lee el PDF, firma y
// escribe su nombre y su identificación. Es una firma electrónica simple con constancia.
export default async function Firmar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await porToken(token);
  if (s && s.estado === "pendiente") {
    const h = await headers();
    await marcarVista(s.id, s.empresa_id, h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null).catch(() => {});
  }
  return (
    <main className="formulario-publico">
      <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
        <LogoCompleto />
        {!s ? (
          <div className="tarjeta"><h1>Enlace no disponible</h1><p>El enlace venció, ya se usó o no existe. Pida a la firma que se lo envíe de nuevo.</p></div>
        ) : s.estado === "firmada" ? (
          <div className="tarjeta">
            <h1>Documento firmado</h1>
            <p><strong>{s.titulo}</strong> fue firmado por {s.firmante_nombre} el {fecha(s.firmado_en)}.</p>
            <p><a className="boton primario" href={`/firmar/${token}/firmado`}>Bajar la copia firmada (PDF)</a></p>
          </div>
        ) : s.estado === "rechazada" ? (
          <div className="tarjeta"><h1>Firma rechazada</h1><p>Usted indicó que no firma <strong>{s.titulo}</strong>. La firma ya fue avisada.</p></div>
        ) : (
          <>
            <h1 style={{ marginBottom: 4 }}>{s.titulo}</h1>
            <p className="sub">
              {s.firma} le envía este documento para firmar{s.firmante ? ` (a nombre de ${s.firmante})` : ""}. Es para {s.empresa}. El enlace vence el {fecha(s.vence)}.
            </p>
            <p>
              <a className="boton primario" href={`/firmar/${token}/documento`} target="_blank" rel="noopener noreferrer">Abrir y leer el documento completo</a>
            </p>
            <iframe src={`/firmar/${token}/documento`} title={`Documento: ${s.titulo}`} style={{ width: "100%", height: "60vh", border: "1px solid var(--borde)", borderRadius: 8, background: "#fff", marginBottom: 16 }} />
            <FirmaForm token={token} />
            <p className="sub" style={{ marginTop: 16 }}>
              Esta es una firma electrónica simple: queda guardada su firma, su nombre, su identificación, la fecha y hora y la dirección de internet desde la que firma, junto con una huella
              del documento. No es una firma digital con certificado.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
