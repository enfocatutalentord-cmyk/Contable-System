import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { CARPETAS } from "@/lib/expediente";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { plantillaDe, valoresDeCliente } from "@/lib/plantillas-documento";
import { ESPACIOS } from "@/lib/plantillas-word";
import { generarDocumentoAccion } from "../../../plantillas-acciones";

export const metadata = { title: "Generar un documento · Empire Tax & Legal" };

const NOMBRE = new Map(ESPACIOS.map((e) => [e.clave, e.nombre]));

// Generar un documento (P3d): cada espacio de la plantilla viene lleno con lo que el sistema sabe del cliente. Se revisa, se corrige lo que haga falta y se
// escribe a mano lo que no se sabe; al generar, sale el Word con su número de referencia y queda en el expediente.
export default async function Generar({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ empresa?: string; plantilla?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  if (!esUuid(sp.empresa ?? "") || !esUuid(sp.plantilla ?? "")) notFound();
  const cliente = (await clientesDeFirma(fid, usuario.id, firma.administrador)).find((c) => c.id === sp.empresa);
  const plantilla = await plantillaDe(fid, sp.plantilla!);
  if (!cliente || !plantilla) notFound();
  const hoy = hoyISO();
  const sabidos = await conEmpresa(cliente.id, (tx) => valoresDeCliente(tx, cliente.id, { firmaNombre: firma.nombre, firmaRnc: firma.rnc, usuarioNombre: usuario.nombre, hoy }));
  const campos = plantilla.campos.filter((c) => c !== "referencia");
  const vacios = campos.filter((c) => !sabidos[c]);

  return (
    <>
      <p><Link href={`/firma/${fid}/plantillas`}>← Documentos y plantillas</Link></p>
      <h1>{plantilla.nombre}</h1>
      <p className="sub">
        Para <strong>{cliente.nombre}</strong>. Revisa lo que el sistema llenó con sus datos y corrige o escribe lo que haga falta. Al generar, el documento sale en Word con su número
        {" "}<strong>ETL-{plantilla.codigo}-{hoy.slice(0, 4)}-NNNN</strong>{plantilla.campos.includes("referencia") ? "" : " (esta plantilla no lo muestra en el texto)"} y se guarda en la carpeta
        {" "}{plantilla.carpeta} · {CARPETAS[plantilla.carpeta]?.nombre} de su expediente.
      </p>
      {vacios.length > 0 && (
        <p className="aviso">
          Falta escribir: {vacios.map((c) => NOMBRE.get(c) ?? c).join(", ")}. Lo que dejes vacío queda en el Word con sus llaves, por ejemplo <code>{`{{${vacios[0]}}}`}</code>, para llenarlo allá.
        </p>
      )}
      <Formulario accion={generarDocumentoAccion.bind(null, fid, cliente.id, plantilla.id)} boton="Generar el Word" className="">
        <div className="fila">
          {campos.map((c) => {
            const largo = c === "socios" || (sabidos[c] ?? "").length > 90;
            return (
              <label key={c} style={{ flex: largo ? "1 1 100%" : "1 1 280px" }}>
                {NOMBRE.get(c) ?? <>Escribe: <code>{c}</code></>}
                {largo
                  ? <textarea name={`v_${c}`} rows={Math.min(8, Math.max(2, (sabidos[c] ?? "").split("\n").length))} defaultValue={sabidos[c] ?? ""} maxLength={4000} />
                  : <input name={`v_${c}`} defaultValue={sabidos[c] ?? ""} maxLength={4000} />}
              </label>
            );
          })}
        </div>
      </Formulario>
    </>
  );
}
