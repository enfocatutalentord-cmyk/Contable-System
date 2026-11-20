-- Prioridad 2.2 (P2c.3, 20-nov-2026): padrón de contribuyentes de la DGII. La DGII no deja consultar su página desde el sistema, así que la
-- dueña de la plataforma sube cada mes el archivo del RNC (DGII_RNC) y el sistema busca el nombre y los datos de un RNC o cédula en su propia base.
-- Son datos públicos de la DGII y no de una empresa: no llevan RLS ni los toca el rol de la aplicación.

CREATE TABLE padron_dgii (
  rnc text PRIMARY KEY CHECK (rnc ~ '^[0-9]{9}$' OR rnc ~ '^[0-9]{11}$'),
  nombre text NOT NULL,
  nombre_comercial text,
  actividad text,
  fecha_inicio date,
  estado text,
  regimen text
);

-- Cada vez que se sube el archivo queda una fila aquí (también las que se cortan a medias).
CREATE TABLE padron_cargas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo text NOT NULL,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre text NOT NULL,
  iniciada timestamptz NOT NULL DEFAULT now(),
  terminada timestamptz,
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completa', 'fallida')),
  filas integer NOT NULL DEFAULT 0 CHECK (filas >= 0),
  rechazadas integer NOT NULL DEFAULT 0 CHECK (rechazadas >= 0),
  nota text
);
CREATE INDEX padron_cargas_idx ON padron_cargas(iniciada DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contable_app') THEN
    REVOKE ALL ON padron_dgii, padron_cargas FROM contable_app;
  END IF;
END $$;
REVOKE ALL ON padron_dgii, padron_cargas FROM PUBLIC;
