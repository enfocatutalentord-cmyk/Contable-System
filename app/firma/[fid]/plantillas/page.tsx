import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { CARPETAS } from "@/lib/expediente";
import { clientesDeFirma } from "@/lib/firma";
import { plantillasDeFirma } from "@/lib/plantillas-documento";
import { CLAVES_ESPACIOS, ESPACIOS } from "@/lib/plantillas-word";
import { verTamano } from "@/lib/documentos";
import { quitarPlantillaAccion, subirPlantilla } from "../../plantillas-acciones";

export const metadata = { title: "Documentos y plantillas · Empire Tax & Legal" };

// Documentos y plantillas (Prioridad 3, P3d): la firma sube plantillas de Word con espacios {{así}} y el sistema las llena con los datos del cliente. El
// documento sale en Word, con su número de referencia, y queda en el expediente del cliente.
export default async function DocumentosYPlantillas({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ hecho?: string; e?: string; ref?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const plantillas = await plantillasDeFirma(fid);
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado");
  const hecho = esUuid(sp.hecho ?? "") && esUuid(sp.e ?? "") ? { doc: sp.hecho!, empresa: sp.e!, ref: (sp.ref ?? "").slice(0, 30) } : null;
  const grupos = [...new Set(ESPACIOS.map((e) => e.grupo))];

  return (
    <>
      <h1>Documentos y plantillas</h1>
      <p className="sub">
        Sube un documento de Word con espacios escritos entre llaves dobles, como {"{{nombre_empresa}}"} o {"{{gerente}}"}, y el sistema lo llena con los datos del cliente. El
        documento sale en Word, con su número de referencia (ETL-XX-AAAA-NNNN), y queda en el expediente del cliente.
      </p>

      {hecho && (
        <p className="exito" role="status" style={{ marginBottom: 16 }}>
          Documento {hecho.ref} generado y guardado en el expediente. <a href={`/e/${hecho.empresa}/documentos/${hecho.doc}`}>Bajar el Word</a> · <Link href={`/e/${hecho.empresa}/expediente`}>Ver el expediente</Link>
        </p>
      )}

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Generar un documento</h2>
        {plantillas.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>Todavía no hay plantillas. {firma.administrador ? "Sube la primera aquí abajo." : "Pídele a una administradora que suba la primera."}</p>
        ) : (
          <form method="get" action={`/firma/${fid}/plantillas/generar`} className="fila">
            <label style={{ flex: "2 1 260px" }}>Cliente
              <select name="empresa" required defaultValue="">
                <option value="" disabled>Elige el cliente</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 260px" }}>Plantilla
              <select name="plantilla" required defaultValue="">
                <option value="" disabled>Elige la plantilla</option>
                {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <button className="primario" type="submit">Continuar</button>
          </form>
        )}
      </section>

      <h2>Plantillas de la firma</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Plantilla</th><th>Espacios</th><th>Se guarda en</th>{firma.administrador && <th />}</tr></thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.nombre}</strong> <span className="sub">· {p.codigo}</span>
                  {p.descripcion && <div className="sub" style={{ margin: 0 }}>{p.descripcion}</div>}
                  <div className="sub" style={{ margin: 0 }}>{p.archivo_nombre} · {verTamano(p.tamano)} · subida el {p.creado}</div>
                  {!p.campos.includes("referencia") && <div className="aviso" style={{ margin: "6px 0 0" }}>No lleva {"{{referencia}}"}: el documento saldrá sin su número.</div>}
                </td>
                <td>
                  <div className="chips-espacios">
                    {p.campos.map((c) => <span key={c} className={`chip-espacio${CLAVES_ESPACIOS.has(c) ? "" : " manual"}`} title={CLAVES_ESPACIOS.has(c) ? "El sistema lo llena" : "Se escribe a mano al generar"}>{`{{${c}}}`}</span>)}
                  </div>
                </td>
                <td>{CARPETAS[p.carpeta]?.nombre ?? p.carpeta}</td>
                {firma.administrador && (
                  <td>
                    <a href={`/firma/${fid}/plantillas/${p.id}/archivo`}>Bajar</a>
                    <Formulario accion={quitarPlantillaAccion.bind(null, fid, p.id)} boton="Quitar" className="fila boton-chico"><span /></Formulario>
                  </td>
                )}
              </tr>
            ))}
            {plantillas.length === 0 && <tr><td colSpan={firma.administrador ? 4 : 3}>No hay plantillas.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sub">En verde, los espacios que el sistema llena solo con los datos del cliente; en amarillo, los que se escriben a mano al generar el documento.</p>

      {firma.administrador && (
        <details className="tarjeta" style={{ marginBottom: 16 }}>
          <summary><strong>+ Subir una plantilla</strong></summary>
          <Formulario accion={subirPlantilla.bind(null, fid)} boton="Guardar la plantilla" className="fila">
            <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" required maxLength={120} placeholder="Carta de ingresos" /></label>
            <label>Código (XX)<input name="codigo" required maxLength={3} placeholder="CA" style={{ width: 80, textTransform: "uppercase" }} /></label>
            <label>Se guarda en
              <select name="carpeta" defaultValue="06">{Object.entries(CARPETAS).map(([k, v]) => <option key={k} value={k}>{k} · {v.nombre}</option>)}</select>
            </label>
            <label style={{ flex: "1 1 100%" }}>Para qué sirve (opcional)<input name="descripcion" maxLength={500} /></label>
            <label style={{ flex: "1 1 100%" }}>Documento de Word (.docx, hasta 4 MB)<input type="file" name="archivo" accept=".docx" required /></label>
          </Formulario>
          <p className="sub">
            El código son dos o tres letras y forman el XX de la referencia (CA para cartas, AC para actas, NS para nóminas de socios…). Un espacio que no está en la lista de abajo se
            escribe a mano cada vez que se genera el documento.
          </p>
        </details>
      )}

      <h2>Espacios que el sistema llena solo</h2>
      <p className="sub">Se escriben tal cual en el Word, con dos llaves a cada lado. Da igual si van en mayúsculas o con tildes: {"{{Nombre Empresa}}"} y {"{{nombre_empresa}}"} son lo mismo.</p>
      <div className="tabla-envoltura">
        <table>
          <tbody>
            {grupos.map((g) => (
              <tr key={g}>
                <th style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{g}</th>
                <td>
                  {ESPACIOS.filter((e) => e.grupo === g).map((e) => (
                    <div key={e.clave}><code>{`{{${e.clave}}}`}</code> <span className="sub">{e.nombre}</span></div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
