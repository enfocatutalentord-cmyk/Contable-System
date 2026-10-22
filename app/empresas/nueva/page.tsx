import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { nuevaEmpresa } from "../../acciones-cuenta";
import { CamposFicha } from "../../campos-ficha";
import { Formulario } from "../../formulario";

export const metadata = { title: "Nuevo cliente · Contable-System" };

export default async function NuevaEmpresa({ searchParams }: { searchParams: Promise<{ firma?: string }> }) {
  const { firma: fid } = await searchParams;
  if (!fid || !esUuid(fid)) notFound();
  const { firma } = await accesoFirma(fid);
  return (
    <main className="contenido" style={{ margin: "0 auto", maxWidth: 900 }}>
      <p><Link href="/empresas">← {firma.nombre}</Link></p>
      <h1>Nuevo cliente</h1>
      <p className="sub">La empresa se crea con el catálogo de cuentas dominicano. Lo puedes ajustar después.</p>
      <div className="tarjeta">
        <Formulario accion={nuevaEmpresa.bind(null, fid)} boton="Crear cliente" className="">
          <CamposFicha />
        </Formulario>
      </div>
    </main>
  );
}
