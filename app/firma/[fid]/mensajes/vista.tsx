import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { CAMPOS, esDeCobro } from "@/lib/mensajes";
import { enlacesDeFirma, plantillasDe } from "@/lib/mensajes-db";
import { guardarPlantillaMensaje, retirarEnlace } from "../../mensajes-acciones";

// Mensajes de WhatsApp (bloque 3c, Documento maestro, sección 10): los textos predeterminados que usa el botón «Enviar por
// WhatsApp» (los cambia un administrador) y los enlaces de descarga que se han compartido, con la opción de retirarlos.
// Rediseño R2: los de cobro se ven en Contabilidad Empire › Mensajes de cobro; los demás y los enlaces, en la Firma.
export async function VistaMensajes({ fid, sp, cobro }: { fid: string; sp: { editar?: string }; cobro: boolean }) {
  const { firma } = await accesoFirma(fid, false);
  const ruta = cobro ? `/firma/${fid}/empire/mensajes` : `/firma/${fid}/mensajes`;
  const [todas, enlaces] = await Promise.all([plantillasDe(fid), cobro ? Promise.resolve([]) : enlacesDeFirma(fid)]);
  const plantillas = todas.filter((p) => esDeCobro(p.clave) === cobro);
  const enEdicion = firma.administrador ? plantillas.find((p) => p.id === sp.editar) : undefined;
  const activos = enlaces.filter((e) => e.activo).length;

  return (
    <>
      <h1>{cobro ? "Mensajes de cobro" : "Mensajes predeterminados"}</h1>
      <p className="sub">
        {cobro
          ? "Los textos de cobro de Empire: cobro de iguala, envío de factura, pago atrasado, pago recibido, cuenta bancaria y el correo de las facturas. Los usa el botón «Enviar por WhatsApp» (y «Enviar por correo») en las facturas y cobros."
          : "Los textos que arma el botón «Enviar por WhatsApp» en propuestas, notificaciones de pago, formularios, alertas y la bitácora. Los de cobro están en Contabilidad Empire › Mensajes de cobro."}
        Los campos entre corchetes se llenan solos: {CAMPOS.map((c) => `[${c}]`).join(", ")}. Lo demás queda entre corchetes para
        escribirlo antes de enviar. {firma.administrador ? "" : "Los textos los cambia un administrador de la firma."}
      </p>

      {enEdicion && (
        <div className="tarjeta" style={{ maxWidth: 760, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Editar «{enEdicion.nombre}»</h2>
          <Formulario key={enEdicion.id} accion={guardarPlantillaMensaje.bind(null, fid, enEdicion.id)} boton="Guardar">
            <label>Nombre<input name="nombre" defaultValue={enEdicion.nombre} required maxLength={80} /></label>
            <label>Texto<textarea name="texto" defaultValue={enEdicion.texto} required maxLength={2000} rows={6} /></label>
          </Formulario>
          <p><Link href={ruta}>Cancelar</Link></p>
        </div>
      )}

      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Mensaje</th><th>Texto</th>{firma.administrador && <th />}</tr></thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id}>
                <td style={{ whiteSpace: "nowrap" }}><strong>{p.nombre}</strong>{p.editado && <div className="sub" style={{ margin: 0 }}>cambiado {p.editado}{p.editado_por && ` por ${p.editado_por}`}</div>}</td>
                <td style={{ minWidth: 280 }}>{p.texto}</td>
                {firma.administrador && <td className="num"><Link href={`${ruta}?editar=${p.id}`}>Editar</Link></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!cobro && <>
      <h2>Enlaces compartidos</h2>
      <p className="sub">
        Cada documento enviado por WhatsApp lleva un enlace para descargarlo sin entrar al sistema. Vence a los 30 días; si se mandó
        por error, retíralo y deja de funcionar. {activos ? `${activos} activo${activos > 1 ? "s" : ""}.` : "No hay enlaces activos."}
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Documento</th><th>Compartido</th><th>Vence</th><th className="num">Descargas</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {enlaces.map((e) => (
              <tr key={e.id} style={e.activo ? undefined : { opacity: 0.6 }}>
                <td>{e.cliente}</td>
                <td>{e.titulo}</td>
                <td>{e.creado}{e.creado_por && <div className="sub" style={{ margin: 0 }}>{e.creado_por}</div>}</td>
                <td>{e.vence}</td>
                <td className="num">{e.descargas}{e.ultima && <div className="sub" style={{ margin: 0 }}>última {e.ultima}</div>}</td>
                <td>{e.estado}</td>
                <td>{e.activo && <Formulario accion={retirarEnlace.bind(null, fid, e.empresa_id, e.id)} boton="Retirar" className="fila"><span /></Formulario>}</td>
              </tr>
            ))}
            {enlaces.length === 0 && <tr><td colSpan={7}>Todavía no se ha compartido ningún documento.</td></tr>}
          </tbody>
        </table>
      </div>
      </>}
    </>
  );
}
