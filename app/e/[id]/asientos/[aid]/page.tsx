import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { TIPOS, verTamano } from "@/lib/documentos";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { adjuntarDocumento, contabilizarBorrador, descartarBorrador, retirarDocumento, revertir } from "../../acciones";
import { HistorialRegistro } from "../../historial/registro";

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "";

const AVISOS: Record<string, string> = {
  guardado: "Borrador guardado.",
  contabilizado: "Asiento contabilizado.",
  revertido: "Reversión registrada y contabilizada.",
};

export default async function VerAsiento({ params, searchParams }: {
  params: Promise<{ id: string; aid: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, aid } = await params;
  const sp = await searchParams;
  if (!esUuid(aid)) notFound();
  const { permisos, empresa, usuario } = await accesoEmpresa(id);

  const datos = await conEmpresa(id, async (tx) => {
    const [a] = await tx<{
      id: string; numero: number | null; fecha: string; concepto: string; referencia: string | null; origen: string; estado: string;
      motivo_anulacion: string | null; anulado_en: Date | null; creado: Date; creado_por_id: string; creado_por: string | null;
      aprobado_por: string | null; aprobado_en: Date | null; modificado_por: string | null; modificado_en: Date | null;
      anulado_por: string | null; revierte_a: string | null; revierte_numero: number | null;
      revertido_por: string | null; revertido_numero: number | null; documento: string | null;
    }[]>`
      SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia, a.origen, a.estado,
             a.motivo_anulacion, a.anulado_en, a.creado, a.creado_por AS creado_por_id, uc.nombre AS creado_por,
             ua.nombre AS aprobado_por, a.aprobado_en, um.nombre AS modificado_por, a.modificado_en, un.nombre AS anulado_por,
             a.revierte_a, o.numero AS revierte_numero, r.id AS revertido_por, r.numero AS revertido_numero,
             COALESCE((SELECT '/facturas/' || f.id FROM facturas f WHERE f.asiento_id = a.id),
                      (SELECT '/cobros/' || c.numero FROM cobros c WHERE c.asiento_id = a.id)) AS documento
        FROM asientos a
        LEFT JOIN usuarios uc ON uc.id = a.creado_por
        LEFT JOIN usuarios ua ON ua.id = a.aprobado_por
        LEFT JOIN usuarios um ON um.id = a.modificado_por
        LEFT JOIN usuarios un ON un.id = a.anulado_por
        LEFT JOIN asientos o ON o.id = a.revierte_a
        LEFT JOIN asientos r ON r.revierte_a = a.id
       WHERE a.id = ${aid}`;
    if (!a) return null;
    const lineas = await tx<{ codigo: string; nombre: string; descripcion: string | null; debe: string; haber: string }[]>`
      SELECT c.codigo, c.nombre, l.descripcion, l.debe::text, l.haber::text
        FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
       WHERE l.asiento_id = ${aid} ORDER BY l.orden`;
    const documentos = await tx<{ id: string; nombre: string; tipo: string; tamano: number; descripcion: string | null; subido_en: Date; quien: string | null }[]>`
      SELECT d.id, d.nombre, d.tipo, d.tamano, d.descripcion, d.subido_en, u.nombre AS quien
        FROM documentos d LEFT JOIN usuarios u ON u.id = d.subido_por
       WHERE d.entidad = 'asiento' AND d.entidad_id = ${aid} AND NOT d.eliminado ORDER BY d.subido_en`;
    return { a, lineas, documentos };
  });
  if (!datos) notFound();
  const { a, lineas, documentos } = datos;
  const totalDebe = lineas.reduce((s, l) => s + Number(l.debe), 0);
  const totalHaber = lineas.reduce((s, l) => s + Number(l.haber), 0);
  const cuadra = Math.round(totalDebe * 100) === Math.round(totalHaber * 100) && totalDebe > 0 && lineas.length >= 2;
  const borrador = a.estado === "borrador";
  const enCierre = !!empresa.fecha_bloqueo && a.fecha <= empresa.fecha_bloqueo;
  const propioConAprobacion = empresa.requiere_aprobacion && a.creado_por_id === usuario.id;
  const titulo = borrador ? "Borrador de asiento" : `Asiento n.º ${a.numero}`;
  const etiqueta = borrador ? "Borrador" : a.estado === "anulado" ? "Anulado" : a.revertido_por ? "Contabilizado · revertido" : "Contabilizado";

  return (
    <>
      <p><Link href={`/e/${id}/asientos${borrador ? "?estado=borrador" : ""}`}>← Asientos</Link></p>
      {Object.entries(AVISOS).map(([k, v]) => sp[k] && <p key={k} className="exito">{v}</p>)}
      <div className="entre">
        <h1>{titulo}</h1>
        <span className={`estado estado-${a.estado}`}>{etiqueta}</span>
      </div>
      <p className="sub">
        {verFecha(a.fecha)} · {a.concepto}{a.referencia && <> · Ref. {a.referencia}</>}
      </p>
      <dl className="ficha-datos">
        <dt>Registrado</dt><dd>{a.creado_por ?? "—"} · {fechaHora(a.creado)}</dd>
        {a.modificado_en && <><dt>Última modificación</dt><dd>{a.modificado_por} · {fechaHora(a.modificado_en)}</dd></>}
        {a.aprobado_en && <><dt>Contabilizado</dt><dd>{a.aprobado_por} · {fechaHora(a.aprobado_en)}</dd></>}
        {a.revierte_a && <><dt>Revierte a</dt><dd><Link href={`/e/${id}/asientos/${a.revierte_a}`}>Asiento n.º {a.revierte_numero}</Link></dd></>}
        {a.revertido_por && <><dt>Revertido por</dt><dd><Link href={`/e/${id}/asientos/${a.revertido_por}`}>Asiento n.º {a.revertido_numero}</Link></dd></>}
        {a.documento && <><dt>Documento de origen</dt><dd><Link href={`/e/${id}${a.documento}`}>Ver documento</Link></dd></>}
        {a.estado === "anulado" && <><dt>Anulado</dt><dd>{a.anulado_por} · {fechaHora(a.anulado_en)} · {a.motivo_anulacion}</dd></>}
      </dl>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuenta</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>{l.codigo} · {l.nombre}</td>
                <td>{l.descripcion}</td>
                <td className="num">{verMonto(l.debe, true)}</td>
                <td className="num">{verMonto(l.haber, true)}</td>
              </tr>
            ))}
            {lineas.length === 0 && <tr><td colSpan={4}>Sin líneas todavía.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Totales{borrador && !cuadra && <span className="error" style={{ marginLeft: 12 }}>No cuadra todavía</span>}</td>
              <td className="num">{verMonto(totalDebe)}</td>
              <td className="num">{verMonto(totalHaber)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {borrador && (
        <div className="fila" style={{ marginTop: 16 }}>
          {puede(permisos, "registrar") && <Link className="boton" href={`/e/${id}/asientos/${aid}/editar`}>Editar</Link>}
          {puede(permisos, "contabilizar") && cuadra && !propioConAprobacion && !enCierre && (
            <Formulario accion={contabilizarBorrador.bind(null, id, aid)} boton="Contabilizar" className="fila"><span /></Formulario>
          )}
          {puede(permisos, "registrar") && (
            <Formulario accion={descartarBorrador.bind(null, id, aid)} boton="Descartar borrador" className="fila"><span /></Formulario>
          )}
        </div>
      )}
      {borrador && propioConAprobacion && <p className="sub" style={{ marginTop: 8 }}>Este borrador lo registraste tú: en esta empresa debe contabilizarlo otra persona.</p>}
      {borrador && enCierre && <p className="aviso" style={{ marginTop: 8 }}>La fecha cae en un período cerrado: cámbiala para poder contabilizarlo.</p>}

      {a.estado === "contabilizado" && a.origen === "manual" && !a.revierte_a && !a.revertido_por && puede(permisos, "revertir") && (
        <>
          <h2>Revertir asiento</h2>
          <p className="sub">
            Lo contabilizado no se edita ni se borra. Para corregirlo se registra un asiento inverso enlazado a este;
            después, si hace falta, registras el asiento correcto.
          </p>
          <Formulario accion={revertir.bind(null, id, aid)} boton="Revertir" className="fila">
            <label>Fecha de la reversión<input type="date" name="fecha" defaultValue={hoyISO() < a.fecha ? a.fecha : hoyISO()} min={a.fecha} required /></label>
            <label style={{ flex: "1 1 300px" }}>Motivo<input name="motivo" required /></label>
          </Formulario>
        </>
      )}

      <h2>Documentos de soporte</h2>
      {documentos.length > 0 ? (
        <div className="tabla-envoltura">
          <table>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td><a href={`/e/${id}/documentos/${d.id}`} target="_blank" rel="noopener">{d.nombre}</a>{d.descripcion && <div className="sub" style={{ margin: 0 }}>{d.descripcion}</div>}</td>
                  <td>{TIPOS[d.tipo]} · {verTamano(d.tamano)}</td>
                  <td>{d.quien} · {fechaHora(d.subido_en)}</td>
                  <td className="num">
                    {borrador && puede(permisos, "adjuntar") && (
                      <Formulario accion={retirarDocumento.bind(null, id, d.id)} boton="Retirar" className="fila"><span /></Formulario>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="sub">Sin documentos adjuntos.</p>}
      {puede(permisos, "adjuntar") && a.estado !== "anulado" && (
        <Formulario accion={adjuntarDocumento.bind(null, id, "asiento", aid)} boton="Adjuntar" className="fila">
          <label style={{ flex: "1 1 260px" }}>Archivo (PDF, JPG o PNG, hasta 4 MB)
            <input type="file" name="archivo" accept="application/pdf,image/jpeg,image/png" required />
          </label>
          <label style={{ flex: "1 1 220px" }}>Descripción (opcional)<input name="descripcion" placeholder="Factura del proveedor, recibo…" /></label>
        </Formulario>
      )}

      {puede(permisos, "auditoria") && (
        <>
          <h2>Historial de este asiento</h2>
          <HistorialRegistro empresaId={id} registroId={aid} />
        </>
      )}
    </>
  );
}
