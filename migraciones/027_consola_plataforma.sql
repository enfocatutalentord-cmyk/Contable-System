-- Consola de la plataforma, entrega 1 (4-nov-2026, «sí» de Joannie): la dueña de la plataforma ve todas las firmas con
-- conteos, suspende o reactiva una firma con un motivo, y cada acción queda en un registro que no se cambia ni se borra.
-- La supervisión de los datos de una firma (con su permiso) llega en la entrega 2.

-- Quién entra a la consola: por correo, para que valga aunque la cuenta se cree después. Solo se agrega por migración.
CREATE TABLE duenas_plataforma (
  correo text PRIMARY KEY CHECK (correo = lower(correo)),
  agregada timestamptz NOT NULL DEFAULT now()
);
INSERT INTO duenas_plataforma (correo) VALUES ('patriciapm2312@gmail.com');

-- Firma suspendida: nadie de la firma entra; los datos se conservan.
ALTER TABLE firmas
  ADD COLUMN suspendida_en timestamptz,
  ADD COLUMN suspendida_motivo text,
  ADD COLUMN suspendida_por uuid REFERENCES usuarios(id);

-- Registro de la consola. Guarda el nombre de la firma tal como era, para no depender de que la firma siga existiendo.
CREATE TABLE registro_plataforma (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL,
  usuario_nombre text NOT NULL,
  firma_id uuid,
  firma_nombre text,
  accion text NOT NULL CHECK (accion IN ('ver_firma', 'suspender', 'reactivar')),
  motivo text,
  en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registro_plataforma_firma_idx ON registro_plataforma(firma_id, en DESC);

CREATE FUNCTION registro_plataforma_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El registro de la plataforma no se cambia ni se borra';
END $$;
CREATE TRIGGER registro_plataforma_inmutable BEFORE UPDATE OR DELETE ON registro_plataforma
  FOR EACH ROW EXECUTE FUNCTION registro_plataforma_inmutable();
