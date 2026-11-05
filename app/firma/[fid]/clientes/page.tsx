import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { urlApp } from "@/lib/enlaces";
import { db } from "@/lib/db";
import { CATEGORIAS, ESTADOS_CLIENTE, MODALIDADES, TIPOS_CLIENTE } from "@/lib/ficha";
import { clientesDeFirma } from "@/lib/firma";
import { filtrarClientes, leerFiltrosLista, resumenLista } from "@/lib/lista-maestra";
import { hoyISO, verFecha } from "@/lib/montos";
import { asignarResponsable, guardarFirma, marcarEmpresaPropia } from "../../acciones";

export const metadata = { title: "Clientes de la firma · Empire Tax’N Legal" };

// Lista maestra de clientes (bloque 1b): lo de la ficha de cada cliente, con filtros y el resumen del Documento maestro.
export default async function Clientes({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid);
  const origen = await urlApp();
  const [todos, equipo] = await Promise.all([
    clientesDeFirma(fid, usuario.id, true, true),
    db()<{ id: string; nombre: string }[]>`
      SELECT u.id, u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${fid} ORDER BY u.nombre`,
  ]);
  const f = leerFiltrosLista(sp);
  const filtrando = Object.values(f).some(Boolean);
  const clientes = filtrarClientes(todos, f);
  const r = resumenLista(todos, hoyISO());
  const propia = todos.find((c) => c.propia);
  const filtro = (campo: string, valor: string) => `/firma/${fid}/clientes?${new URLSearchParams({ [campo]: valor })}`;
  const opciones = (mapa: Record<string, string>) => Object.entries(mapa).map(([k, v]) => <option key={k} value={k}>{v}</option>);

  return (
    <>
      <div className="entre">
        <div>
          <h1>Clientes de la firma</h1>
          <p className="sub">La lista maestra: los datos salen de la ficha de cada cliente. El responsable es la persona del equipo que se ocupa de cada uno.</p>
        </div>
        <Link className="boton primario" href={`/firma/${fid}/clientes/nuevo`}>+ Nuevo cliente</Link>
      </div>

      <div className="cifras">
        <Link className="tarjeta cifra" href={filtro("estado", "activo")}><div className="etiqueta">Clientes activos</div><div className="valor">{r.activos}</div></Link>
        <div className="tarjeta cifra"><div className="etiqueta">Nuevos este mes</div><div className="valor">{r.nuevos}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Retirados o en cero</div><div className="valor">{r.retiradosOEnCero}</div></div>
        <Link className="tarjeta cifra" href={filtro("formalizacion", "no")}><div className="etiqueta">Sin formalizar</div><div className="valor">{r.noFormalizados}</div></Link>
        {r.prospectos > 0 && <Link className="tarjeta cifra" href={filtro("estado", "prospecto")}><div className="etiqueta">Prospectos de la aplicación</div><div className="valor">{r.prospectos}</div></Link>}
      </div>
      <p className="sub">El total a facturar llega con las igualas (bloque 2). «Sin formalizar»: falta la fecha de la ficha, la hoja de acuerdo o el contrato firmados.</p>

      <form className="fila" style={{ marginBottom: 12 }} aria-label="Filtros">
        <label style={{ flex: "2 1 200px" }}>Buscar<input name="buscar" defaultValue={f.buscar} placeholder="Nombre o RNC" /></label>
        <label>Categoría<select name="categoria" defaultValue={f.categoria}><option value="">Todas</option>{opciones(CATEGORIAS)}<option value="ninguno">Sin categoría</option></select></label>
        <label>Tipo de cliente<select name="tipo" defaultValue={f.tipo}><option value="">Todos</option>{opciones(TIPOS_CLIENTE)}<option value="ninguno">Sin tipo</option></select></label>
        <label>Estado<select name="estado" defaultValue={f.estado}><option value="">Todos</option>{opciones(ESTADOS_CLIENTE)}</select></label>
        <label>Modalidad<select name="modalidad" defaultValue={f.modalidad}><option value="">Todas</option>{opciones(MODALIDADES)}<option value="ninguno">Sin modalidad</option></select></label>
        <label>Formalización<select name="formalizacion" defaultValue={f.formalizacion}><option value="">Todas</option><option value="si">Formalizados</option><option value="no">Sin formalizar</option></select></label>
        <label>Responsable
          <select name="responsable" defaultValue={f.responsable}>
            <option value="">Todos</option>
            {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            <option value="ninguno">Sin responsable</option>
          </select>
        </label>
        <button>Filtrar</button>
        {filtrando && <Link href={`/firma/${fid}/clientes`}>Quitar filtros</Link>}
      </form>

      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr><th>Cliente</th><th>Categoría</th><th>Tipo</th><th>Estado</th><th>Formalizado</th><th>Modalidad</th><th>Responsable</th><th>Cerrado hasta</th></tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} style={c.activa ? undefined : { opacity: 0.6 }}>
                <td>
                  <Link href={`/e/${c.id}`}><strong>{c.nombre}</strong></Link>
                  {c.propia && <span className="etiqueta-propia"> · empresa propia</span>}
                  <div className="sub" style={{ margin: 0 }}>{c.rnc ?? "Sin RNC"} · <Link href={`/e/${c.id}/empresa`}>Ficha</Link></div>
                </td>
                <td>{c.categoria ? CATEGORIAS[c.categoria] : "—"}</td>
                <td>{c.tipo_cliente ? TIPOS_CLIENTE[c.tipo_cliente] : "—"}</td>
                <td>{c.activa ? ESTADOS_CLIENTE[c.estado_cliente] : "Inactivo en el sistema"}</td>
                <td>{c.formalizado ? "Sí" : "No"}</td>
                <td>{c.modalidad ? MODALIDADES[c.modalidad].replace(/^\d · /, "") : "—"}</td>
                <td>
                  <Formulario accion={asignarResponsable.bind(null, fid, c.id)} boton="Guardar" className="fila">
                    <select name="responsable" defaultValue={c.responsable_id ?? ""} aria-label={`Responsable de ${c.nombre}`}>
                      <option value="">Sin responsable</option>
                      {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </Formulario>
                </td>
                <td>{c.fecha_bloqueo ? verFecha(c.fecha_bloqueo) : "—"}</td>
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={8}>{filtrando ? "Ningún cliente cumple los filtros." : "Todavía no hay clientes."}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="tarjeta" style={{ maxWidth: 640, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Empresa propia de la firma</h2>
        <p className="sub">
          La contabilidad de la firma se lleva como un cliente más. Al elegirla, cada cliente de la firma queda registrado en su
          facturación con los datos de su ficha (y se pone al día solo cuando la ficha cambia). También se le crean las unidades de
          negocio (Firma contable, Laboratorio de Imperios y Sistema), sus cuentas de ingreso, las cuentas de Banco Popular,
          Banreservas y BHD y la cuenta corriente de cada socia (cuenta por cobrar). Elegir otra vez la misma solo completa lo que falte.
        </p>
        <Formulario accion={marcarEmpresaPropia.bind(null, fid)} boton="Guardar empresa propia" className="fila">
          <select name="empresa" defaultValue={propia?.id ?? ""} aria-label="Empresa propia" style={{ flex: "2 1 260px" }}>
            <option value="">Ninguna</option>
            {todos.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.rnc ? ` · ${c.rnc}` : ""}</option>)}
          </select>
        </Formulario>
      </div>

      <div className="tarjeta" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Datos de la firma</h2>
        <p className="sub">El nombre sale arriba en todas las pantallas y en los correos de acceso.</p>
        <Formulario accion={guardarFirma.bind(null, fid)} boton="Guardar datos de la firma" className="fila">
          <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" defaultValue={firma.nombre} required /></label>
          <label style={{ flex: "1 1 160px" }}>RNC<input name="rnc" defaultValue={firma.rnc ?? ""} inputMode="numeric" /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 100%" }}>
            <input type="checkbox" name="exigir_dos_pasos" defaultChecked={firma.exigir_dos_pasos} style={{ minHeight: 0 }} />
            Exigir verificación en dos pasos a todo el equipo y a los usuarios de los clientes (quien no la tenga, la activa al entrar)
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 100%" }}>
            <input type="checkbox" name="alta_clientes" defaultChecked={firma.alta_clientes} style={{ minHeight: 0 }} />
            Abrir la página «Crear mi cuenta» de la aplicación: quien se registre queda como prospecto
          </label>
          {firma.alta_clientes && <p className="sub" style={{ flex: "1 1 100%", margin: 0 }}>Dirección para compartir (web, redes, WhatsApp): <code>{`${origen}/unirse/${fid}`}</code></p>}
        </Formulario>
      </div>
    </>
  );
}
