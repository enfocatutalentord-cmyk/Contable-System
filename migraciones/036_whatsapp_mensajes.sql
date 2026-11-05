-- Bloque 3, entrega 3c (Sistema Empire, «sí» de Patricia del 4-nov-2026): WhatsApp y mensajes predeterminados (Documento maestro,
-- sección 10). Envío con clic (wa.me): el sistema arma el mensaje con los datos del cliente y un enlace seguro para descargar el
-- PDF; la coordinadora elige el chat o el grupo, puede editar el texto y el envío queda en la bitácora (se puede deshacer).

-- ───── Mensajes predeterminados por firma (los edita un administrador: Patricia) ─────
CREATE TABLE plantillas_mensaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  clave text NOT NULL CHECK (clave ~ '^[a-z0-9_]{2,40}$'),
  orden int NOT NULL DEFAULT 0,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  editado_por uuid REFERENCES usuarios(id),
  editado timestamptz,
  UNIQUE (firma_id, clave)
);

-- Los textos del Documento maestro, sección 10 (los campos entre corchetes se llenan solos; todos terminan con la firma).
-- «Envío de factura» está en la lista del documento pero no tiene texto propio: se escribió uno en el mismo tono, para revisar.
CREATE FUNCTION crear_plantillas_mensaje(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  SELECT fid, x.clave, x.orden, x.nombre, x.texto || ' -- Empire Tax’N Legal'
    FROM (VALUES
      ('bienvenida', 1, 'Bienvenida', $t$Buenos días, [nombre]. Bienvenido a Empire Tax’N Legal. Le saluda la Coordinación; a partir de hoy acompañaremos a [empresa] en su gestión contable y fiscal. Este grupo es nuestro canal oficial para documentos, reportes y consultas.$t$),
      ('ficha_registro', 2, 'Ficha de Registro', $t$Buenos días, [nombre]. Para formalizar su registro, complete la Ficha de Registro en este enlace: [enlace]. Al final podrá adjuntar los documentos indicados. Quedamos atentos.$t$),
      ('constitucion', 3, 'Formulario de constitución', $t$Buenos días, [nombre]. Para iniciar la constitución de su empresa, complete este formulario: [enlace]. Tenga a mano las cédulas de los socios (ambos lados) y tres opciones de nombre comercial.$t$),
      ('firma_contrato', 4, 'Firma de contrato', $t$Buenos días, [nombre]. Le compartimos su contrato de servicios y la Hoja de Acuerdo con las condiciones conversadas con la Lic. Patricia Paulino: [enlace]. Favor revisarlos, firmarlos y remitirlos por esta vía.$t$),
      ('propuesta', 5, 'Cotización o propuesta', $t$Buenos días, [nombre]. Le compartimos la propuesta para [servicio]: [enlace]. Incluye requisitos, anticipo y fecha estimada de entrega. Cualquier duda, con gusto le asistimos.$t$),
      ('cobro_iguala', 6, 'Cobro de iguala', $t$Buenos días, [nombre]. Le compartimos su factura y estado de cuenta de la iguala de [mes], por RD$[monto]: [enlace]. Agradecemos realizar el pago del día 1 al 5 y remitirnos el comprobante por esta vía.$t$),
      ('envio_factura', 7, 'Envío de factura', $t$Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto]: [enlace]. Agradecemos remitirnos el comprobante de pago por esta vía.$t$),
      ('pago_atrasado', 8, 'Pago atrasado', $t$Buenos días, [nombre]. Le recordamos que su iguala de [mes], por RD$[monto], se encuentra pendiente. Agradecemos regularizarla a la mayor brevedad. Si ya realizó el pago, favor compartirnos el comprobante.$t$),
      ('pago_recibido', 9, 'Pago recibido', $t$Buenos días, [nombre]. Confirmamos la recepción de su pago por RD$[monto] correspondiente a [concepto]. Gracias por su puntualidad.$t$),
      ('cuenta_bancaria', 10, 'Cuenta bancaria', $t$Buenos días. Estos son los datos para su pago: Empire Tax’N Legal SRL, RNC 133-09734-6, [banco], cuenta [tipo] No. [número]. Favor remitir el comprobante por esta vía.$t$),
      ('facturas_606', 11, 'Facturas para el 606', $t$Buenos días, [nombre]. Para el registro contable y sus declaraciones, favor remitirnos las facturas de compras y gastos de [mes] a más tardar el día 10.$t$),
      ('constancia', 12, 'Constancia de declaración', $t$Buenos días, [nombre]. Le compartimos la constancia de [declaración] de [período]: [enlace]. Monto a pagar: RD$[monto], antes del [fecha límite].$t$),
      ('notificacion_tss', 13, 'Notificación TSS', $t$Buenos días, [nombre]. Le compartimos la notificación de pago de la TSS de [mes], por RD$[monto]: [enlace]. Favor pagar antes del [fecha límite] para evitar recargos.$t$),
      ('requerimiento', 14, 'Requerimiento pendiente', $t$Buenos días, [nombre]. Damos seguimiento a la información pendiente para completar su proceso: [detalle]. Tan pronto nos la remita, continuamos.$t$),
      ('recomendacion', 15, 'Recomendación por escrito', $t$Buenos días, [nombre]. Por indicación de la Lic. Patricia Paulino, dejamos por escrito nuestra recomendación sobre [tema]: [recomendación]. No seguirla puede implicar [riesgo]. La decisión corresponde a la empresa; agradecemos confirmarnos cómo desean proceder.$t$),
      ('documento_listo', 16, 'Documento listo', $t$Buenos días, [nombre]. Su [documento] está listo: [enlace]. Favor firmarlo, sellarlo y remitirnos una copia para su expediente.$t$),
      ('comprobantes', 17, 'Comprobantes por agotarse', $t$Buenos días, [nombre]. A [empresa] le quedan [cantidad] comprobantes [tipo]. Procederemos a solicitar un nuevo rango para que no se detenga su facturación.$t$),
      ('reporte_mensual', 18, 'Reporte mensual', $t$Buenos días, [nombre]. Le compartimos el reporte de [mes] con todo el trabajo realizado para [empresa], junto a la factura del mes: [enlace]. Quedamos atentos a cualquier solicitud.$t$),
      ('proyeccion_ir2', 19, 'Proyección IR-2', $t$Buenos días, [nombre]. Le compartimos la proyección de cierre fiscal de [empresa] con lo acumulado a [mes]: [enlace]. Aún hay tiempo para tomar decisiones antes del cierre; la Lic. Patricia Paulino le contactará para revisarla.$t$),
      ('ajuste_iguala', 20, 'Ajuste de iguala (60 días antes)', $t$Buenos días, [nombre]. Gracias por la confianza de este año. Le compartimos el comunicado sobre la actualización de su iguala, que aplicará a partir de [mes]: [enlace]. Favor firmar el acuse de recibo.$t$),
      ('aniversario', 21, 'Aniversario', $t$Buenos días, [nombre]. Hoy [empresa] cumple [años] año(s) con Empire Tax’N Legal. Gracias por su fidelidad y confianza. Como agradecimiento, la iguala de este mes tiene un 10% de descuento.$t$),
      ('cumpleanos', 22, 'Cumpleaños', $t$¡Feliz cumpleaños, [nombre]! Todo el equipo de Empire Tax’N Legal le desea un año lleno de salud, crecimiento y éxitos.$t$),
      ('saludo_lunes', 23, 'Saludo de los lunes', $t$Buenos días. Iniciamos la semana a su disposición. Cualquier documento, consulta o solicitud, estamos atentos por esta vía.$t$),
      ('cita', 24, 'Confirmación de cita', $t$Buenos días, [nombre]. Le confirmamos su cita con la Lic. Patricia Paulino mañana [fecha] a las [hora] en [lugar]. Favor confirmar su asistencia.$t$)
    ) AS x(clave, orden, nombre, texto)
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje(id) FROM firmas;

-- ───── Enlaces seguros para descargar un PDF sin entrar al sistema ─────
-- Se guarda solo el hash del enlace; vence a los 30 días (respuesta de Patricia del 4-nov) y se puede quitar antes.
CREATE TABLE enlaces_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('factura', 'propuesta', 'documento')),
  ref_id uuid NOT NULL,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  vence timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revocado_en timestamptz,
  revocado_por uuid REFERENCES usuarios(id),
  descargas int NOT NULL DEFAULT 0,
  ultima_descarga timestamptz
);
CREATE INDEX enlaces_documento_idx ON enlaces_documento(empresa_id, creado DESC);

-- ───── Mensajes enviados (cada uno deja su gestión en la bitácora) ─────
CREATE TABLE mensajes_enviados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  clave text NOT NULL,
  nombre text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 4000),
  destino text NOT NULL CHECK (destino IN ('contacto', 'elegir')),
  telefono text,
  ref_tipo text CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion')),
  ref_id uuid,
  enlace_id uuid REFERENCES enlaces_documento(id) ON DELETE SET NULL,
  enviado_por uuid NOT NULL REFERENCES usuarios(id),
  enviado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensajes_enviados_idx ON mensajes_enviados(empresa_id, enviado_en DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['enlaces_documento', 'mensajes_enviados'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- El enlace se busca por su hash antes de saber de qué empresa es (descarga sin sesión): solo esa tabla no lleva FORCE,
    -- así la conexión dueña la puede leer; el rol de la aplicación sigue viendo solo lo de su empresa.
    IF t <> 'enlaces_documento' THEN EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t); END IF;
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- La bitácora acepta lo que viene de un mensaje.
ALTER TABLE gestiones DROP CONSTRAINT gestiones_origen_check;
ALTER TABLE gestiones ADD CONSTRAINT gestiones_origen_check
  CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion', 'mensaje'));

CREATE FUNCTION gestion_mensaje() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE titulo text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deshacer el envío quita también su gestión.
    DELETE FROM gestiones WHERE empresa_id = OLD.empresa_id AND origen = 'mensaje' AND origen_id = OLD.id;
    RETURN NULL;
  END IF;
  SELECT e.titulo INTO titulo FROM enlaces_documento e WHERE e.id = NEW.enlace_id;
  PERFORM anotar_gestion(NEW.empresa_id, (NEW.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date, 'mensaje',
    'WhatsApp: ' || NEW.nombre || COALESCE(' · ' || titulo, '') ||
    CASE WHEN NEW.destino = 'contacto' AND NEW.telefono IS NOT NULL THEN ' (al ' || NEW.telefono || ')' ELSE ' (chat o grupo elegido)' END,
    'mensaje', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER mensajes_enviados_gestion AFTER INSERT OR DELETE ON mensajes_enviados FOR EACH ROW EXECUTE FUNCTION gestion_mensaje();
