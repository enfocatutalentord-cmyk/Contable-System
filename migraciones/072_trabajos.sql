-- Prioridad 2.2 (P2d, 20-nov-2026): el trabajo es la solicitud de servicio que ya existía, ahora con requisitos, precio y factura.
-- Los requisitos de cada servicio se escriben una vez en la lista de precios de la empresa propia y se copian a cada trabajo (ahí se pueden
-- cambiar); un trabajo con un requisito obligatorio pendiente no se entrega. El precio y la factura salen del mismo trabajo.

-- Requisitos de cada servicio de la lista de precios (empresa propia): qué información o documentos se le piden al cliente.
CREATE TABLE requisitos_servicio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  servicio_id uuid NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 300),
  obligatorio boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true
);
CREATE INDEX requisitos_servicio_idx ON requisitos_servicio(servicio_id, orden) WHERE activo;

-- Los requisitos de un trabajo concreto: se copian del servicio y se les va marcando lo que llegó.
CREATE TABLE requisitos_solicitud (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  solicitud_id uuid NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 300),
  obligatorio boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibido', 'no_aplica')),
  recibido_en timestamptz,
  recibido_por uuid REFERENCES usuarios(id),
  nota text CHECK (nota IS NULL OR length(nota) <= 300),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requisitos_solicitud_idx ON requisitos_solicitud(solicitud_id, orden);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requisitos_servicio', 'requisitos_solicitud'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- Un requisito es de la misma empresa que su solicitud y que su servicio.
CREATE FUNCTION requisito_de_su_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'requisitos_solicitud' THEN
    IF NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.id = NEW.solicitud_id AND s.empresa_id = NEW.empresa_id) THEN
      RAISE EXCEPTION 'La solicitud no es de esta empresa';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM servicios s WHERE s.id = NEW.servicio_id AND s.empresa_id = NEW.empresa_id) THEN
      RAISE EXCEPTION 'El servicio no es de esta empresa';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER requisito_de_su_empresa BEFORE INSERT OR UPDATE ON requisitos_solicitud FOR EACH ROW EXECUTE FUNCTION requisito_de_su_empresa();
CREATE TRIGGER requisito_de_su_empresa BEFORE INSERT OR UPDATE ON requisitos_servicio FOR EACH ROW EXECUTE FUNCTION requisito_de_su_empresa();

-- Precio acordado del trabajo y la factura que salió de él (la factura vive en la empresa propia, por eso no lleva llave foránea).
ALTER TABLE solicitudes
  ADD COLUMN precio numeric(18,2) CHECK (precio IS NULL OR precio >= 0),
  ADD COLUMN factura_id uuid,
  ADD COLUMN facturado_en timestamptz;

-- No se entrega un trabajo con un requisito obligatorio que todavía no llegó.
CREATE FUNCTION solicitud_requisitos_pendientes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.estado = 'entregada' AND OLD.estado IS DISTINCT FROM 'entregada' THEN
    SELECT count(*) INTO n FROM requisitos_solicitud WHERE solicitud_id = NEW.id AND obligatorio AND estado = 'pendiente';
    IF n > 0 THEN
      IF n = 1 THEN
        RAISE EXCEPTION 'No se puede entregar: falta 1 requisito obligatorio por recibir';
      END IF;
      RAISE EXCEPTION 'No se puede entregar: faltan % requisitos obligatorios por recibir', n;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitud_requisitos_pendientes BEFORE UPDATE OF estado ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION solicitud_requisitos_pendientes();

-- Mensaje de WhatsApp para pedirle al cliente lo que falta (Patricia lo revisa).
CREATE OR REPLACE FUNCTION crear_plantillas_mensaje_extra(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'solicitud_servicio', 25, 'Solicitud de servicio',
          'Buenos días, [nombre]. Para atender su solicitud, complete este formulario con lo que necesita y para cuándo: [enlace]. Con eso le preparamos la cotización. -- Empire Tax & Legal'),
         (fid, 'requisitos_servicio', 26, 'Requisitos del servicio',
          E'Buenos días, [nombre]. Para avanzar con [servicio] necesitamos que nos envíe lo siguiente:\n[requisitos]\nEn cuanto lo tengamos, empezamos. -- Empire Tax & Legal'),
         (fid, 'correo_factura', 30, 'Correo: envío de factura',
          'Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto], que va adjunta en PDF. Agradecemos remitirnos el comprobante de pago respondiendo este correo.')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje_extra(id) FROM firmas;
