import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { CARPETAS } from "@/lib/expediente";
import { clientesDeFirma } from "@/lib/firma";
import { verFecha } from "@/lib/montos";
import { crearSolicitudFirma } from "../../../firma-digital-acciones";

export const metadata = { title: "Pedir una firma · Empire Tax & Legal" };

// Pedir una firma (P3e), paso 2: de qué cliente es y qué documento va a firmar (un PDF de su expediente, una propuesta de Empire o uno que se sube).
export default async function NuevaFirma({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ empresa?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  if (!esUuid(sp.empresa ?? "")) notFound();
  const cliente = (await clientesDeFirma(fid, usuario.id, firma.administrador)).find((c) => c.id === sp.empresa);
  if (!cliente) notFound();
  const pdfs = await conEmpresa(cliente.id, (tx) => tx<{ id: string; nombre: string; descripcion: string | null; carpeta: string | null; fecha: string }[]>`
    SELECT id, nombre, descripcion, carpeta, to_char(subido_en AT TIME ZONE 'America/Santo_Domingo', 'YYYY-MM-DD') AS fecha
      FROM documentos WHERE entidad = 'expediente' AND tipo = 'application/pdf' AND NOT eliminado ORDER BY subido_en DESC LIMIT 100`);
  const propuestas = firma.empresa_propia_id ? await conEmpresa(firma.empresa_propia_id, (tx) => tx<{ id: string; numero: number; fecha: string; estado: string }[]>`
    SELECT p.id, p.numero, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.estado FROM propuestas p JOIN clientes c ON c.id = p.cliente_id
     WHERE c.empresa_vinculada_id = ${cliente.id} ORDER BY p.numero DESC LIMIT 50`) : [];

  return (
    <>
      <p><Link href={`/firma/${fid}/firmas`}>← Firma digital</Link></p>
      <h1>Pedir una firma</h1>
      <p className="sub">Para <strong>{cliente.nombre}</strong>. Elige el documento que va a firmar. El documento que se manda no se cambia: lo que se firma es exactamente este PDF.</p>
      <Formulario accion={crearSolicitudFirma.bind(null, fid, cliente.id)} boton="Crear la solicitud" className="">
        <fieldset className="tarjeta" style={{ marginBottom: 12 }}>
          <legend><strong>Documento</strong></legend>
          {pdfs.length > 0 && (
            <>
              <p className="sub" style={{ marginTop: 0 }}>Un PDF de su expediente:</p>
              {pdfs.map((d) => (
                <label key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="radio" name="fuente" value={`exp:${d.id}`} style={{ minHeight: 0 }} />
                  <span>{d.descripcion || d.nombre} <span className="sub">· {d.carpeta ? CARPETAS[d.carpeta]?.nombre : "Expediente"} · {verFecha(d.fecha)}</span></span>
                </label>
              ))}
            </>
          )}
          {propuestas.length > 0 && (
            <>
              <p className="sub">Una propuesta de Empire (se arma el PDF en este momento):</p>
              {propuestas.map((p) => (
                <label key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="radio" name="fuente" value={`prop:${p.id}`} style={{ minHeight: 0 }} />
                  <span>Propuesta n.º {p.numero} <span className="sub">· {verFecha(p.fecha)} · {p.estado}</span></span>
                </label>
              ))}
            </>
          )}
          <p className="sub">O sube un PDF (hasta 4 MB):</p>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="radio" name="fuente" value="subir" defaultChecked={pdfs.length === 0 && propuestas.length === 0} style={{ minHeight: 0 }} />
            <input type="file" name="archivo" accept="application/pdf,.pdf" />
          </label>
        </fieldset>
        <div className="fila">
          <label style={{ flex: "2 1 260px" }}>Cómo se llama el documento (opcional)<input name="titulo" maxLength={200} placeholder="Si lo dejas vacío, se usa el nombre del archivo" /></label>
          <label style={{ flex: "1 1 220px" }}>A nombre de quién (opcional)<input name="firmante" maxLength={120} placeholder="Quien debe firmar" /></label>
          <label>La copia firmada se guarda en
            <select name="carpeta" defaultValue="06">{Object.entries(CARPETAS).map(([k, v]) => <option key={k} value={k}>{k} · {v.nombre}</option>)}</select>
          </label>
        </div>
      </Formulario>
    </>
  );
}
