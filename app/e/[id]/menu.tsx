"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FUERA_DEL_MENU, GRUPO_PRIVADO, PESTANAS_ADMINISTRACION, PESTANAS_CLIENTE, puedeVer } from "@/lib/pestanas";

// Cómo se llaman las pestañas para el cliente en su aplicación (bloque 8a).
const NOMBRES_CLIENTE: Record<string, string> = { "": "Inicio", "/facturas-subidas": "Mis facturas", "/recepcion": "Mis documentos", "/solicitudes": "Mis solicitudes" };

type Clave = "firma" | "empire" | "talleres" | "administracion";

// Menú en cuatro secciones con desplegables (rediseño R1, «Lista de rediseños» de Patricia del 6-nov-2026): Firma (el trabajo a los
// clientes), Contabilidad Empire (la empresa propia), Talleres (reservada) y Administración. Cada sección muestra solo lo suyo y se
// abre sola la que tiene la pantalla en la que se está.
// pestanas: las que ve el rol de la persona en la empresa elegida (null = todas). soloCliente: usuario de una empresa cliente, que
// solo ve su aplicación. propia: la empresa propia de la firma.
export function Menu({ firmaId, empresaId, admin, auditoria, pestanas, soloCliente, propia = null }: {
  firmaId: string; empresaId: string | null; admin: boolean; auditoria: boolean; pestanas: string[] | null; soloCliente: boolean;
  propia?: { id: string; nombre: string } | null;
}) {
  const ruta = usePathname();
  const firma = `/firma/${firmaId}`;
  const base = empresaId ? `/e/${empresaId}` : null;
  const enPropia = !!propia && empresaId === propia.id;

  const general: [string, string][] = [[firma, "Inicio de la firma"], [`${firma}/documentos`, "Documentos recibidos"], [`${firma}/facturas-subidas`, "Facturas por revisar"], [`${firma}/alertas`, "Alertas"], [`${firma}/tareas`, "Tareas del mes"], [`${firma}/impuestos`, "Impuestos del mes"], [`${firma}/reportes`, "Reportes del mes"], [`${firma}/tramites`, "Trámites abiertos"], [`${firma}/solicitudes`, "Solicitudes"], [`${firma}/mensajes`, "Mensajes predeterminados"], [`${firma}/bitacora`, "Bitácora de la firma"]];
  const deLaFirma: [string, string][] = [
    ...(admin ? [[`${firma}/clientes`, "Empresas Empire"], [`${firma}/equipo`, "Personas y accesos"], [`${firma}/perfiles`, "Roles y permisos"]] as [string, string][] : []),
    [`${firma}/actividad`, "Actividad"],
  ];
  const visible = (r: string) => !FUERA_DEL_MENU.includes(r) && puedeVer(pestanas, r) && (r !== "/historial" || auditoria || !base);
  // Pestañas de la empresa elegida: las de cada cliente en Firma; las de la empresa propia en Contabilidad Empire (con lo de la socia).
  // Usuarios e historial de cambios van en Administración.
  const grupos = PESTANAS_CLIENTE.filter((s) => s.grupo !== GRUPO_PRIVADO || enPropia).map((s) => ({
    ...s, enlaces: s.enlaces.filter(([r]) => !PESTANAS_ADMINISTRACION.includes(r) && visible(r)),
  })).filter((s) => s.enlaces.length);
  const deEmpresa = PESTANAS_ADMINISTRACION.filter(visible);
  const todas = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

  const activoFirma = (href: string) => (href === firma ? ruta === firma : ruta === href || ruta.startsWith(href + "/"));
  const activoEmpresa = (r: string) => {
    if (!base) return false;
    const href = base + r;
    return r === "" ? ruta === base
      : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(base + o)));
  };
  const hrefEmpresa = (r: string) => (base ? base + r : `${firma}/elegir?a=${encodeURIComponent(r || "/")}`);
  const enlaceFirma = ([href, nombre]: [string, string]) => (
    <Link key={href} href={href} aria-current={activoFirma(href) ? "page" : undefined}>{nombre}</Link>
  );
  const enlacesEmpresa = (soloNombres = false) => grupos.map((s, i) => (
    <div key={i} className="subgrupo">
      {s.grupo && !soloNombres && <div className="grupo">{s.grupo === "Cliente elegido" && enPropia ? propia!.nombre : s.grupo}</div>}
      {s.enlaces.map(([r, nombre]) => (
        <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>
          {soloNombres ? (NOMBRES_CLIENTE[r] ?? nombre) : enPropia && r === "" ? "Resumen de la empresa" : nombre}
        </Link>
      ))}
    </div>
  ));

  // Sección donde está la pantalla abierta.
  const enAdmin = deLaFirma.some(([h]) => activoFirma(h)) || deEmpresa.some((r) => activoEmpresa(r));
  const actual: Clave = enAdmin ? "administracion" : enPropia ? "empire" : "firma";
  const [abiertas, setAbiertas] = useState<Record<Clave, boolean>>({ firma: actual === "firma", empire: actual === "empire", talleres: false, administracion: actual === "administracion" });
  useEffect(() => { setAbiertas((a) => (a[actual] ? a : { ...a, [actual]: true })); }, [actual]);

  if (soloCliente) return <>{enlacesEmpresa(true)}</>;

  const seccion = (clave: Clave, titulo: string, contenido: React.ReactNode) => (
    <details className="seccion" open={abiertas[clave]} onToggle={(e) => {
      const abierta = (e.currentTarget as HTMLDetailsElement).open;
      setAbiertas((a) => (a[clave] === abierta ? a : { ...a, [clave]: abierta }));
    }}>
      <summary aria-current={actual === clave ? "true" : undefined}>{titulo}</summary>
      <div className="seccion-cuerpo">{contenido}</div>
    </details>
  );

  return (
    <>
      {seccion("firma", "Firma", <>
        {general.map(enlaceFirma)}
        {!enPropia && enlacesEmpresa()}
      </>)}
      {seccion("empire", "Contabilidad Empire", propia ? <>
        {enPropia ? enlacesEmpresa() : <Link href={`/e/${propia.id}`}>Abrir la contabilidad de {propia.nombre}</Link>}
      </> : (
        <p className="nota-menu">
          {admin ? <>Todavía no está elegida la empresa propia. <Link href={`${firma}/clientes#empresa-propia`}>Elegirla</Link></> : "Todavía no está elegida la empresa propia de la firma."}
        </p>
      ))}
      {seccion("talleres", "Talleres", <p className="nota-menu">Próximamente. Se definen en una fase aparte.</p>)}
      {seccion("administracion", "Administración", <>
        {deLaFirma.map(enlaceFirma)}
        {deEmpresa.length > 0 && (
          <div className="subgrupo">
            <div className="grupo">{enPropia ? propia!.nombre : "Cliente elegido"}</div>
            {deEmpresa.map((r) => (
              <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>
                {r === "/usuarios" ? "Usuarios y permisos" : "Historial de cambios"}
              </Link>
            ))}
          </div>
        )}
      </>)}
    </>
  );
}
