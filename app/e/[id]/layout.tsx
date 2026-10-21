import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { NOMBRE_ROL } from "@/lib/permisos";
import { salir } from "../../acciones-cuenta";
import { Menu } from "./menu";

export default async function LayoutEmpresa({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, usuario, rol } = await accesoEmpresa(id);
  return (
    <div className="app">
      <nav className="menu" aria-label="Menú principal">
        <div className="marca">Contable-System</div>
        <div className="empresa">
          {empresa.nombre}
          {empresa.rnc && <> · RNC {empresa.rnc}</>}
          <div><Link href="/empresas">Cambiar de empresa</Link></div>
        </div>
        <Menu empresaId={id} />
        <div className="pie">
          <Link href="/cuenta">{usuario.nombre}</Link> · {NOMBRE_ROL[rol]}
          <form action={salir}><button style={{ marginTop: 8 }}>Salir</button></form>
        </div>
      </nav>
      <main className="contenido">{children}</main>
    </div>
  );
}
