-- Rediseño R6 (Lista de rediseños de Patricia, 6-nov-2026, n.º 19): permisos por persona con casillas, por sección.
-- Hasta ahora cada persona recibía un rol cliente por cliente. Desde aquí, a una persona del equipo se le pueden marcar sus propios
-- permisos y pantallas para la Firma (los clientes) y para Contabilidad Empire, con un alcance por sección: todos los clientes, solo
-- los suyos (donde es responsable) o los que se elijan. Los roles quedan como plantillas que suman casillas. Quien no tenga
-- permisos propios sigue con sus roles cliente por cliente: nada cambia para nadie hasta que se le marquen.

ALTER TABLE miembros_firma
  ADD COLUMN permisos_clientes text[],          -- NULL: sin permisos propios en los clientes (usa sus roles cliente por cliente)
  ADD COLUMN pestanas_clientes text[],
  ADD COLUMN alcance text NOT NULL DEFAULT 'elegidos' CHECK (alcance IN ('todos', 'mis_clientes', 'elegidos')),
  ADD COLUMN clientes uuid[] NOT NULL DEFAULT '{}', -- con alcance «elegidos»
  ADD COLUMN permisos_empire text[],            -- NULL: sin acceso propio a Contabilidad Empire
  ADD COLUMN pestanas_empire text[],
  ADD COLUMN crear_clientes boolean NOT NULL DEFAULT false,
  ADD COLUMN plantillas text[] NOT NULL DEFAULT '{}', -- roles que se usaron como punto de partida (para mostrarlo)
  ADD COLUMN permisos_por text,                 -- quién y cuándo, para el aviso en Personas y accesos
  ADD COLUMN permisos_en timestamptz;
