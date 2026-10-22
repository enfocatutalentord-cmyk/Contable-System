import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { puede } from "@/lib/permisos";
import { salir } from "../../acciones-cuenta";
import { MarcaMenu } from "../../marca";
import { Menu } from "./menu";

export default async function LayoutEmpresa({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, usuario, perfil, permisos } = await accesoEmpresa(id);
  return (
    <div className="app">
      <nav className="menu" aria-label="Menú principal">
        <MarcaMenu />
        <div className="empresa">
          <div style={{ fontSize: "0.78rem" }}>{empresa.firma}</div>
          <strong>{empresa.nombre}</strong>
          {empresa.rnc && <> · {empresa.rnc}</>}
          {!empresa.activa && <div className="error" style={{ margin: 0 }}>Cliente inactivo</div>}
          <div><Link href="/empresas">Cambiar de cliente</Link></div>
        </div>
        <Menu empresaId={id} auditoria={puede(permisos, "auditoria")} />
        <div className="pie">
          <Link href="/cuenta">{usuario.nombre}</Link> · {perfil}
          <form action={salir}><button style={{ marginTop: 8 }}>Salir</button></form>
        </div>
      </nav>
      <main className="contenido">{children}</main>
    </div>
  );
}
