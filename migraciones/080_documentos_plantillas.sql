-- Prioridad 3 · P3d · Documentos y plantillas (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas). La firma sube plantillas de Word con espacios
-- {{nombre_empresa}} y el sistema las llena con los datos del cliente. El documento sale en Word, con un número de referencia ETL-XX-AAAA-NNNN, y queda en
-- el expediente del cliente.

-- Las plantillas son de la firma (sin RLS, siempre filtradas por firma, como plantillas_tarea). El código de dos o tres letras es el XX de la referencia.
CREATE TABLE plantillas_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 3 AND 120),
  codigo text NOT NULL CHECK (codigo ~ '^[A-Z]{2,3}$'),
  descripcion text CHECK (descripcion IS NULL OR length(descripcion) <= 500),
  carpeta text NOT NULL DEFAULT '06' CHECK (carpeta IN ('01', '02', '03', '04', '05', '06')),   -- carpeta del expediente donde queda lo generado
  archivo_nombre text NOT NULL,
  archivo bytea NOT NULL CHECK (octet_length(archivo) <= 4194304),
  campos text[] NOT NULL DEFAULT '{}',                  -- los espacios que tiene, en orden
  activa boolean NOT NULL DEFAULT true,                 -- quitar = esconder
  creado_por uuid REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plantillas_documento_firma ON plantillas_documento (firma_id, activa, nombre);

-- El número que sigue de cada código y año de una firma. Solo lo mueve la función de abajo.
CREATE TABLE referencias_documento (
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  anio int NOT NULL,
  ultimo int NOT NULL,
  PRIMARY KEY (firma_id, codigo, anio)
);

-- Toma el número siguiente para la empresa en curso (de su firma). Corre dentro de la misma transacción que guarda el documento: si algo falla, el número
-- no se gasta. SECURITY DEFINER porque la empresa no lee las tablas de la firma.
CREATE FUNCTION siguiente_referencia_documento(cod text, a int) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO referencias_documento (firma_id, codigo, anio, ultimo)
  VALUES ((SELECT firma_id FROM empresas WHERE id = empresa_actual()), cod, a, 1)
  ON CONFLICT (firma_id, codigo, anio) DO UPDATE SET ultimo = referencias_documento.ultimo + 1
  RETURNING ultimo
$$;
GRANT EXECUTE ON FUNCTION siguiente_referencia_documento(text, int) TO contable_app;

-- Lo generado para cada cliente: qué plantilla, qué número, qué se escribió en cada espacio y el archivo (que vive en `documentos`, en su expediente).
CREATE TABLE documentos_generados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  plantilla_id uuid REFERENCES plantillas_documento(id) ON DELETE SET NULL,
  plantilla_nombre text NOT NULL,
  referencia text NOT NULL,
  documento_id uuid NOT NULL REFERENCES documentos(id),
  valores jsonb NOT NULL DEFAULT '{}',
  sin_llenar text[] NOT NULL DEFAULT '{}',              -- espacios que quedaron con sus llaves por falta de dato
  generado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, referencia)
);
CREATE INDEX documentos_generados_empresa ON documentos_generados (empresa_id, creado DESC);
ALTER TABLE documentos_generados ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_generados FORCE ROW LEVEL SECURITY;
CREATE POLICY documentos_generados_empresa ON documentos_generados USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT ON documentos_generados TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON documentos_generados FOR EACH ROW EXECUTE FUNCTION auditar();
