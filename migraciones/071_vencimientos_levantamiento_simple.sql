-- Prioridad 2.2 (P2c.4, 20-nov-2026): documentos que vencen en la ficha del cliente y levantamiento simple o completo.

-- Cada documento del cliente que vence (registro mercantil, ONAPI, certificado de la DGII, contrato de alquiler, poder, firma digital…) con la
-- fecha y los días de aviso. Se puede ligar a un archivo del expediente. Al renovarlo se cambia la fecha; el historial guarda la anterior.
CREATE TABLE vencimientos_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0 AND length(nombre) <= 200),
  vence date NOT NULL,
  avisar_dias integer NOT NULL DEFAULT 60 CHECK (avisar_dias BETWEEN 0 AND 365),
  documento_id uuid REFERENCES documentos(id) ON DELETE SET NULL,
  nota text CHECK (nota IS NULL OR length(nota) <= 500),
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vencimientos_empresa_idx ON vencimientos_empresa(empresa_id, vence) WHERE activo;

ALTER TABLE vencimientos_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE vencimientos_empresa FORCE ROW LEVEL SECURITY;
CREATE POLICY vencimientos_empresa_empresa ON vencimientos_empresa USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON vencimientos_empresa TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON vencimientos_empresa FOR EACH ROW EXECUTE FUNCTION auditar();

-- El archivo ligado debe ser de la misma empresa.
CREATE FUNCTION vencimiento_documento_propio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.documento_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documentos d WHERE d.id = NEW.documento_id AND d.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El documento no es de esta empresa';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vencimiento_documento_propio BEFORE INSERT OR UPDATE ON vencimientos_empresa
  FOR EACH ROW EXECUTE FUNCTION vencimiento_documento_propio();

-- Levantamiento simple (datos generales, ingresos, nómina y necesidades, sin anexos ni estado inicial) o completo (todo, como hasta hoy).
ALTER TABLE formularios ADD COLUMN modo text NOT NULL DEFAULT 'completo' CHECK (modo IN ('simple', 'completo'));
