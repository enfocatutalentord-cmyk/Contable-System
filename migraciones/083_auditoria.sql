-- Prioridad 3 · P3j · Auditoría: plan y hallazgos (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas). Cada auditoría es de un cliente y tiene su objetivo,
-- alcance, período auditado, fechas de trabajo y equipo; una lista de pasos del plan que se marcan; y hallazgos con situación, criterio, causa, efecto y recomendación,
-- cada uno con sus fotos y archivos de prueba. No se sigue ningún estándar (NIA) a menos que la firma lo escriba en el alcance. Los archivos van en «documentos»
-- (entidad 'auditoria'; entidad_id = la auditoría o el hallazgo). El informe final en PDF es la entrega P3k.

ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite', 'formulario', 'factura_subida', 'pago_impuesto', 'auditoria'));

CREATE TABLE auditorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 3 AND 150),
  objetivo text NOT NULL DEFAULT '' CHECK (length(objetivo) <= 2000),
  alcance text NOT NULL DEFAULT '' CHECK (length(alcance) <= 2000),
  periodo_desde date,
  periodo_hasta date,
  fecha_inicio date,
  fecha_fin date,
  responsable_id uuid REFERENCES usuarios(id),
  equipo uuid[] NOT NULL DEFAULT '{}',
  estado text NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada', 'en_curso', 'en_informe', 'cerrada')),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  cerrada_por uuid REFERENCES usuarios(id),
  cerrada_en timestamptz,
  UNIQUE (empresa_id, numero),
  CHECK (periodo_desde IS NULL OR periodo_hasta IS NULL OR periodo_desde <= periodo_hasta),
  CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_inicio <= fecha_fin)
);

CREATE TABLE auditoria_pasos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  auditoria_id uuid NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
  orden int NOT NULL DEFAULT 0,
  descripcion text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 300),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'hecho', 'no_aplica')),
  responsable_id uuid REFERENCES usuarios(id),
  nota text NOT NULL DEFAULT '' CHECK (length(nota) <= 1000),
  hecho_por uuid REFERENCES usuarios(id),
  hecho_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_pasos_idx ON auditoria_pasos(auditoria_id, orden);

CREATE TABLE auditoria_hallazgos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  auditoria_id uuid NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
  numero int NOT NULL,
  paso_id uuid REFERENCES auditoria_pasos(id) ON DELETE SET NULL,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 150),
  situacion text NOT NULL DEFAULT '' CHECK (length(situacion) <= 3000),       -- lo que se encontró
  criterio text NOT NULL DEFAULT '' CHECK (length(criterio) <= 3000),         -- lo que debería ser (norma, política, contrato…)
  causa text NOT NULL DEFAULT '' CHECK (length(causa) <= 3000),
  efecto text NOT NULL DEFAULT '' CHECK (length(efecto) <= 3000),
  recomendacion text NOT NULL DEFAULT '' CHECK (length(recomendacion) <= 3000),
  riesgo text NOT NULL DEFAULT 'medio' CHECK (riesgo IN ('alto', 'medio', 'bajo')),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_seguimiento', 'resuelto', 'aceptado')),
  respuesta text NOT NULL DEFAULT '' CHECK (length(respuesta) <= 2000),       -- respuesta o compromiso del cliente, o cómo se resolvió
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auditoria_id, numero)
);

-- Una auditoría cerrada no se toca: ni sus pasos ni sus hallazgos ni ella misma (salvo reabrirla, que es devolverla a «en informe»).
CREATE FUNCTION auditoria_cerrada_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid uuid; cerrada boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- borrado en cascada al quitar la empresa
  aid := CASE WHEN TG_OP = 'DELETE' THEN OLD.auditoria_id ELSE NEW.auditoria_id END;
  SELECT estado = 'cerrada' INTO cerrada FROM auditorias WHERE id = aid;
  IF cerrada THEN RAISE EXCEPTION 'La auditoría está cerrada: reábrela para cambiar sus pasos o hallazgos.' USING ERRCODE = 'P0001'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER auditoria_pasos_cerrada BEFORE INSERT OR UPDATE OR DELETE ON auditoria_pasos FOR EACH ROW EXECUTE FUNCTION auditoria_cerrada_proteger();
CREATE TRIGGER auditoria_hallazgos_cerrada BEFORE INSERT OR UPDATE OR DELETE ON auditoria_hallazgos FOR EACH ROW EXECUTE FUNCTION auditoria_cerrada_proteger();

CREATE FUNCTION auditorias_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'cerrada' AND NEW.estado = 'cerrada' THEN
    RAISE EXCEPTION 'La auditoría está cerrada: reábrela para cambiarla.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auditorias_cerrada BEFORE UPDATE ON auditorias FOR EACH ROW EXECUTE FUNCTION auditorias_proteger();

ALTER TABLE auditorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditorias FORCE ROW LEVEL SECURITY;
CREATE POLICY auditorias_empresa ON auditorias USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON auditorias TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON auditorias FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE auditoria_pasos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_pasos FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_pasos_empresa ON auditoria_pasos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON auditoria_pasos TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON auditoria_pasos FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE auditoria_hallazgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_hallazgos FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_hallazgos_empresa ON auditoria_hallazgos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON auditoria_hallazgos TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON auditoria_hallazgos FOR EACH ROW EXECUTE FUNCTION auditar();
