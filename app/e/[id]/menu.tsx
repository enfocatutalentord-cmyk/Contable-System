"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FUERA_DEL_MENU, PESTANAS_ADMINISTRACION, PESTANAS_CLIENTE, PESTANAS_CONTABLES, PESTANAS_SOLO_PROPIA, puedeVer } from "@/lib/pestanas";

// Cómo se llaman las pestañas para el cliente en su aplicación (bloque 8a).
const NOMBRES_CLIENTE: Record<string, string> = { "": "Inicio", "/facturas-subidas": "Mis facturas", "/recepcion": "Mis documentos", "/solicitudes": "Mis solicitudes" };

type Clave = "firma" | "empire" | "talleres" | "administracion";

// Menú en cuatro secciones con desplegables (rediseño R1, «Lista de rediseños» de Patricia del 6-nov-2026): Firma (el trabajo a los
// clientes), Contabilidad Empire (la empresa propia), Talleres (reservada) y Administración. Cada sección muestra solo lo suyo y se
// abre sola la que tiene la pantalla en la que se está.
// pestanas: las que ve el rol de la persona en la empresa elegida (null = todas). soloCliente: usuario de una empresa cliente, que
// solo ve su aplicación. propia: la empresa propia de la firma.
// pestanasPropia: lo que la persona ve en la empresa propia, para mostrar Contabilidad Empire aunque esté en un cliente (R2).
export function Menu({ firmaId, empresaId, admin, auditoria, pestanas, soloCliente, propia = null, pestanasPropia = false }: {
  firmaId: string; empresaId: string | null; admin: boolean; auditoria: boolean; pestanas: string[] | null; soloCliente: boolean;
  propia?: { id: string; nombre: string } | null; pestanasPropia?: string[] | null | false;
}) {
  const ruta = usePathname();
  const firma = `/firma/${firmaId}`;
  const base = empresaId ? `/e/${empresaId}` : null;
  const enPropia = !!propia && empresaId === propia.id;

  const deLaFirma: [string, string][] = [
    ...(admin ? [[`${firma}/clientes`, "Empresas Empire"], [`${firma}/equipo`, "Personas y accesos"], [`${firma}/perfiles`, "Roles y permisos"], [`${firma}/normas`, "Normas y tasas"]] as [string, string][] : []),
    [`${firma}/actividad`, "Actividad"],
  ];
  const visible = (r: string) => !FUERA_DEL_MENU.includes(r) && puedeVer(pestanas, r) && (r !== "/historial" || auditoria || !base);
  // Pestañas de un cliente, en Firma: sin lo que solo es de Empire (igualas, recurrentes, propuestas, lo de la socia). Usuarios e
  // historial de cambios van en Administración.
  const grupos = PESTANAS_CLIENTE.map((s) => ({
    ...s, enlaces: s.enlaces.filter(([r]) => !PESTANAS_ADMINISTRACION.includes(r) && !PESTANAS_SOLO_PROPIA.includes(r) && visible(r)
      && (base || !PESTANAS_CONTABLES.includes(r))), // sin cliente elegido no se sabe si lleva contabilidad: casi ninguno la lleva (R3)
  })).filter((s) => s.enlaces.length);
  // Pestañas de la empresa propia, en Contabilidad Empire (siempre, aunque se esté en un cliente).
  const basePropia = propia ? `/e/${propia.id}` : null;
  const gruposPropia = pestanasPropia === false || !basePropia ? [] : PESTANAS_CLIENTE.map((s) => ({
    ...s, enlaces: s.enlaces.filter(([r]) => !PESTANAS_ADMINISTRACION.includes(r) && !FUERA_DEL_MENU.includes(r) && puedeVer(pestanasPropia, r)),
  })).filter((s) => s.enlaces.length);
  const deCobro: [string, string][] = [[`${firma}/empire/tareas`, "Tareas de cobro"], [`${firma}/empire/mensajes`, "Mensajes de cobro"],
    ...(admin ? [[`${firma}/empire/presupuesto`, "Presupuesto"]] as [string, string][] : [])];
  const deEmpresa = PESTANAS_ADMINISTRACION.filter(visible);
  const todas = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

  const activoFirma = (href: string) => (href === firma ? ruta === firma : ruta === href || ruta.startsWith(href + "/"));
  const activoEn = (b: string | null, r: string) => {
    if (!b) return false;
    const href = b + r;
    return r === "" ? ruta === b
      : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(b + o)));
  };
  const activoEmpresa = (r: string) => activoEn(base, r);
  const hrefEmpresa = (r: string) => (base ? base + r : `${firma}/elegir?a=${encodeURIComponent(r || "/")}`);
  const enlaceFirma = ([href, nombre]: [string, string]) => (
    <Link key={href} href={href} aria-current={activoFirma(href) ? "page" : undefined}>{nombre}</Link>
  );
  // Firma por trabajos (rediseño R4, n.º 2): se elige primero el trabajo y después el cliente. Lo de todos los clientes abre la
  // pantalla de la firma; lo de un cliente abre el cliente elegido arriba o pide elegirlo. Ya no hay un bloque del cliente con todo.
  const clienteElegido = base && !enPropia ? base : null;
  // Dentro de Empire no hay cliente elegido: se ofrecen las pestañas de un cliente cualquiera (sin contabilidad).
  const deCliente = new Set(enPropia
    ? PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r)).filter((r) => !PESTANAS_ADMINISTRACION.includes(r) && !PESTANAS_SOLO_PROPIA.includes(r)
      && !PESTANAS_CONTABLES.includes(r) && !FUERA_DEL_MENU.includes(r))
    : grupos.flatMap((s) => s.enlaces.map(([r]) => r)));
  const nombreDe = new Map(PESTANAS_CLIENTE.flatMap((s) => s.enlaces));
  type Trabajo = { firma: string; nombre: string } | { cliente: string; nombre?: string };
  const trabajos: [string, Trabajo[]][] = [
    ["Trabajo del mes", [{ firma, nombre: "Inicio de la firma" }, { cliente: "", nombre: "Resumen del cliente" }, { firma: `${firma}/alertas`, nombre: "Alertas" },
      { firma: `${firma}/tareas`, nombre: "Tareas del mes" }, { firma: `${firma}/impuestos`, nombre: "Impuestos del mes" },
      { firma: `${firma}/reportes`, nombre: "Reportes del mes" }, { firma: `${firma}/bitacora`, nombre: "Bitácora de la firma" },
      { firma: `${firma}/mensajes`, nombre: "Mensajes predeterminados" }]],
    ["Facturas y documentos", [{ firma: `${firma}/documentos`, nombre: "Documentos recibidos" }, { firma: `${firma}/facturas-subidas`, nombre: "Facturas del cliente" },
      { cliente: "/facturas" }, { cliente: "/compras" }, { cliente: "/clientes" }, { cliente: "/proveedores" }, { cliente: "/servicios" }]],
    ["Impuestos", [{ cliente: "/dgii" }, { cliente: "/notificaciones" }, { cliente: "/comprobantes" }, { cliente: "/fiscal" },
      { cliente: "/fiscal/impuestos" }, { cliente: "/fiscal/retenciones" }, { cliente: "/fiscal/probar" }]],
    ["Reportes", [{ cliente: "/estados" }, { cliente: "/reportes" }]],
    ["Expediente y trámites", [{ firma: `${firma}/tramites`, nombre: "Trámites abiertos" }, { firma: `${firma}/solicitudes`, nombre: "Solicitudes" },
      { cliente: "/expediente" }, { cliente: "/solicitudes" }, { cliente: "/recepcion" }, { cliente: "/bitacora", nombre: "Bitácora del cliente" }]],
    ["Cobros y pagos", [{ cliente: "/cobros" }, { cliente: "/anticipos" }, { cliente: "/cxc" }, { cliente: "/pagos" }, { cliente: "/cxp" }]],
    ["Contabilidad del cliente", PESTANAS_CONTABLES.filter((r) => !/^\/(cobros|anticipos|cxc|pagos|cxp)/.test(r)).map((r) => ({ cliente: r }))],
  ];
  // Lo de un cliente que no tenga su lugar arriba (una pestaña nueva) no se pierde: va en «Otros».
  const ubicadas = new Set(trabajos.flatMap(([, t]) => t.map((x) => ("cliente" in x ? x.cliente : ""))));
  const otros = [...deCliente].filter((r) => !ubicadas.has(r) && r !== "/facturas-subidas").map((r) => ({ cliente: r }));
  if (otros.length) trabajos.push(["Otros", otros]);
  const enlacesTrabajos = trabajos.map(([grupo, lista]) => {
    const items = lista.filter((t) => !("cliente" in t) || deCliente.has(t.cliente));
    if (!items.length) return null;
    return (
      <div key={grupo} className="subgrupo">
        <div className="grupo">{grupo}</div>
        {items.map((t) => "firma" in t ? enlaceFirma([t.firma, t.nombre]) : (
          <Link key={t.cliente} href={clienteElegido ? clienteElegido + t.cliente : `${firma}/elegir?a=${encodeURIComponent(t.cliente || "/")}`}
            aria-current={clienteElegido && activoEmpresa(t.cliente) ? "page" : undefined}>{t.nombre ?? nombreDe.get(t.cliente) ?? t.cliente}</Link>
        ))}
      </div>
    );
  });
  const enlacesEmpresa = (soloNombres = false) => grupos.map((s, i) => (
    <div key={i} className="subgrupo">
      {s.grupo && !soloNombres && <div className="grupo">{s.grupo === "Cliente elegido" && !base ? "De un cliente (se elige al abrir)" : s.grupo}</div>}
      {s.enlaces.map(([r, nombre]) => (
        <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>{soloNombres ? (NOMBRES_CLIENTE[r] ?? nombre) : nombre}</Link>
      ))}
    </div>
  ));
  const enlacesPropia = gruposPropia.map((s, i) => (
    <div key={i} className="subgrupo">
      {s.grupo && s.grupo !== "Cliente elegido" && <div className="grupo">{s.grupo === "Configuración del cliente" ? "Configuración" : s.grupo}</div>}
      {s.enlaces.map(([r, nombre]) => (
        <Link key={r} href={basePropia + r} aria-current={activoEn(basePropia, r) ? "page" : undefined}>
          {r === "" ? "Resumen de Empire" : nombre}
        </Link>
      ))}
    </div>
  ));

  // Sección donde está la pantalla abierta.
  const enAdmin = deLaFirma.some(([h]) => activoFirma(h)) || deEmpresa.some((r) => activoEmpresa(r));
  const actual: Clave = enAdmin ? "administracion" : enPropia || ruta.startsWith(`${firma}/empire`) ? "empire" : "firma";
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
      {seccion("firma", "Firma", <>{enlacesTrabajos}</>)}
      {seccion("empire", "Contabilidad Empire", <>
        {enlacesPropia}
        {!enlacesPropia.length && (
          <p className="nota-menu">
            {propia ? "No tienes acceso a la contabilidad de Empire."
              : admin ? <>Todavía no está elegida la empresa propia. <Link href={`${firma}/clientes#empresa-propia`}>Elegirla</Link></>
              : "La contabilidad de Empire la ven quienes tienen acceso a ella."}
          </p>
        )}
        <div className="subgrupo">
          <div className="grupo">Cobros de Empire</div>
          {deCobro.map(enlaceFirma)}
        </div>
      </>)}
      {seccion("talleres", "Talleres", <p className="nota-menu">Próximamente. Se definen en una fase aparte.</p>)}
      {seccion("administracion", "Administración", <>
        {deLaFirma.map(enlaceFirma)}
        {deEmpresa.length > 0 && (
          <div className="subgrupo">
            <div className="grupo">{enPropia ? propia!.nombre : base ? "Cliente elegido" : "De un cliente"}</div>
            {deEmpresa.map((r) => (
              <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>
                {r === "/usuarios" ? "Usuarios y permisos" : r === "/empresa" ? (enPropia ? "Ficha de la empresa" : "Ficha del cliente") : "Historial de cambios"}
              </Link>
            ))}
          </div>
        )}
      </>)}
    </>
  );
}
