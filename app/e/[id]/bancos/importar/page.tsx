import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { listarCuentasBancarias } from "@/lib/bancos";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { importarDesdeRecepcion } from "../../bancos-acciones";

export const metadata = { title: "Importar estado de cuenta · Empire Tax’N Legal" };

// Un estado de cuenta que el cliente subió en «Mis documentos»: se elige a qué cuenta bancaria va y se abre la vista previa.
export default async function ImportarRecibido({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recepcion?: string }>;
}) {
  const { id } = await params;
  const { recepcion } = await searchParams;
  if (!recepcion || !esUuid(recepcion)) notFound();
  const { permisos } = await accesoEmpresa(id);
  if (!puede(permisos, "registrar")) redirect(`/e/${id}/bancos?sin_permiso=1`);
  const { doc, cuentas } = await conEmpresa(id, async (tx) => ({
    doc: (await tx<{ nombre: string; nota: string | null }[]>`SELECT nombre, nota FROM recepciones WHERE id = ${recepcion} AND categoria = 'estado_bancario'`)[0],
    cuentas: (await listarCuentasBancarias(tx)).filter((c) => c.activa),
  }));
  if (!doc) notFound();

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/recepcion`}>← Documentos del cliente</Link></p>
      <h1>Importar estado de cuenta</h1>
      <p className="sub">{doc.nombre}{doc.nota && ` · «${doc.nota}»`}</p>
      <div className="tarjeta">
        {cuentas.length === 0 ? (
          <p className="aviso">Este cliente no tiene cuentas bancarias. Agrégala primero en <Link href={`/e/${id}/bancos`}>Bancos</Link>.</p>
        ) : (
          <Formulario accion={importarDesdeRecepcion.bind(null, id, recepcion)} boton="Ver la vista previa" className="fila">
            <label style={{ flex: "1 1 300px" }}>¿De qué cuenta es?
              <select name="cuenta_bancaria_id" required defaultValue={cuentas.length === 1 ? cuentas[0].id : ""}>
                <option value="" disabled>Elige…</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.banco}{c.numero && ` ****${c.numero}`}</option>)}
              </select>
            </label>
          </Formulario>
        )}
      </div>
    </>
  );
}
