-- Bloque 1, entrega 1a (4-nov-2026, «sí» de Patricia): ficha única del cliente ampliada, según el Documento maestro,
-- sección 5. Los datos de hoy se quedan; lo nuevo queda vacío en los clientes existentes hasta que se llene.

ALTER TABLE empresas
  -- Empresa
  ADD COLUMN tipo_sociedad text,
  ADD COLUMN fecha_constitucion date,
  ADD COLUMN municipio text,
  ADD COLUMN provincia text,
  ADD COLUMN capital_social numeric(18,2) CHECK (capital_social >= 0),
  ADD COLUMN grupo_whatsapp text,
  -- Operaciones (definen la categoría)
  ADD COLUMN ventas_mes numeric(18,2) CHECK (ventas_mes >= 0),
  ADD COLUMN facturas_mes int CHECK (facturas_mes >= 0),
  ADD COLUMN empleados_mes int CHECK (empleados_mes >= 0),
  ADD COLUMN tiene_tss boolean,
  ADD COLUMN emite_ecf boolean,
  ADD COLUMN sistema_usa text,
  -- Relación con Empire
  ADD COLUMN categoria text CHECK (categoria IN ('pequena', 'mediana', 'grande', 'emprendedor')),
  ADD COLUMN tipo_cliente text CHECK (tipo_cliente IN ('iguala', 'por_trabajo', 'esporadico')),
  ADD COLUMN fecha_inicio_contrato date,
  ADD COLUMN dia_facturacion int CHECK (dia_facturacion BETWEEN 1 AND 31),
  ADD COLUMN estado_cliente text NOT NULL DEFAULT 'activo' CHECK (estado_cliente IN ('activo', 'en_cero', 'sin_operaciones', 'retirado')),
  ADD COLUMN ficha_firmada date,
  ADD COLUMN hoja_firmada date,
  ADD COLUMN contrato_firmado date,
  ADD COLUMN modalidad text CHECK (modalidad IN ('aplicacion', 'sistema_propio', 'independiente')),
  ADD COLUMN custodio_accesos text;  -- solo quién custodia los accesos de DGII y TSS; las claves nunca se guardan

CREATE TABLE socios_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  cedula text,
  telefono text,
  porcentaje numeric(5,2) CHECK (porcentaje BETWEEN 0 AND 100)
);

CREATE TABLE contactos_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  rol text NOT NULL CHECK (rol IN ('principal', 'alterno', 'representante', 'gerente')),
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  cedula text,
  cargo text,
  telefono text,
  whatsapp text,
  correo text,
  nacimiento date,
  UNIQUE (empresa_id, rol)
);

-- Lleva sueldos: la pantalla solo la muestra a quien tiene el permiso «empresa».
CREATE TABLE empleados_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  cedula text,
  cargo text,
  fecha_ingreso date,
  sueldo numeric(18,2) CHECK (sueldo >= 0)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['socios_empresa', 'contactos_empresa', 'empleados_empresa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- El logo y el membrete del cliente se guardan como documentos de la empresa (entidad «empresa», descripción «logo»):
-- así su contenido no se copia en el historial de cambios, como pasa con los demás adjuntos.
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa'));
