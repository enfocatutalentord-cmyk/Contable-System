import Link from "next/link";
import type { Usuario } from "@/lib/auth";
import { salir } from "./acciones-cuenta";
import { Menu } from "./e/[id]/menu";
import { MarcaMenu } from "./marca";
import { MenuMovil } from "./menu-movil";
import { SelectorCliente } from "./selector-cliente";

// Marco único de la aplicación: el mismo menú en toda la firma y, arriba, el selector de cliente.
// Con «Todos los clientes» se ven las pantallas de la firma; al elegir un cliente, cada pestaña muestra solo lo suyo
// (como el selector de cliente de QuickBooks Online Accountant).
export function Marco({ firma, clientes, actual, usuario, perfil, admin, auditoria, pestanas = null, soloCliente = false, children }: {
  firma: { id: string; nombre: string };
  clientes: { id: string; nombre: string }[];
  actual: string | null;
  usuario: Usuario;
  perfil: string;
  admin: boolean;
  auditoria: boolean;
  pestanas?: string[] | null;
  soloCliente?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <nav className="menu" aria-label="Menú principal">
        <MenuMovil marca={<MarcaMenu />}>
          <Menu firmaId={firma.id} empresaId={actual} admin={admin} auditoria={auditoria} pestanas={pestanas} soloCliente={soloCliente} />
          <div className="pie">
            <Link href="/cuenta">{usuario.nombre}</Link> · {perfil}
            <form action={salir}><button style={{ marginTop: 8 }}>Salir</button></form>
          </div>
        </MenuMovil>
      </nav>
      <div className="principal">
        <header className="barra-cliente">
          <SelectorCliente firmaId={firma.id} clientes={clientes} actual={actual} todos={!soloCliente} />
          <span className="firma-nombre">{firma.nombre}</span>
        </header>
        <main className="contenido">{children}</main>
      </div>
    </div>
  );
}
