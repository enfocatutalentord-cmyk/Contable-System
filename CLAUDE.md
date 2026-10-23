# Contable-System: estado del proyecto y forma de trabajo

Este archivo es el punto de partida para seguir el trabajo desde cualquier sesión o plataforma.
Actualízalo al terminar cada bloque de trabajo (qué se hizo, qué quedó pendiente, qué decidió Joannie).

Última actualización: 23-oct-2026 (Fases 1 a 4 aprobadas y en `main`).

## Con quién y cómo

- Se trabaja con **Joannie** (Enfoca Tu Talento). Responder siempre en **español**, con tono humano, claro y sin tecnicismos
  innecesarios. Explicar los pasos en el panel (Vercel, GitHub, midominio.do) uno por uno, con lo que hay que hacer clic.
- La cuenta de la app en producción la abrió **Manaury Enrique Gómez Guerrero**, con la empresa **Goemhy Services** (RNC 132151119).
- **Nunca pasar nada a `main` sin el «sí» de Joannie.** Se trabaja en la rama `claude/gallant-bell-4ejogr` y se pasa a `main`
  (fast-forward) solo cuando ella lo aprueba. `main` publica solo en producción.
- Todo lo que se proponga debe basarse en lo que hoy usan las plataformas líderes y mejor valoradas (G2, Capterra, casos
  publicados), citando la fuente. Referentes elegidos: **Xero** (G2 4.4, fechas de bloqueo, conciliación con reglas),
  **QuickBooks Online** (G2 4.0, centro de reportes, antigüedad de saldos, portal del contador) y **Alegra** (referente en RD,
  606/607/608 y e-CF).
- No inventar datos, montos ni resultados. Antes de decir que algo funciona, probarlo.

## Documento rector

**`docs/requerimientos-sistema.md`** (22-oct-2026) manda sobre todo lo anterior: sistema para **firmas contables** con
varios clientes, por fases con aprobación expresa, sin módulos ni cambios no autorizados. Antes de desarrollar se presenta
la estructura técnica, dependencias y orden (aprobada por Joannie el 22-oct-2026 con el orden de fases de abajo).

## Línea gráfica

Desde el 22-oct-2026 (pedido de Joannie) el sistema lleva la identidad de **Empire Tax’N Legal** según
`docs/Empire_Brandbook.pdf`: verde institucional `#003D19`, dorado `#B88A40`, marfil `#F6F3EC`; tipografía Source Sans 3
(la misma de la web de Empire). Logos maestros en `public/marca/` (copiados de `empire-web/public/assets`; `simbolo-inverso.svg`
es el símbolo con la columna en blanco para el fondo verde). Componentes en `app/marca.tsx`; colores en `app/globals.css`;
encabezados verdes con línea dorada en Excel y PDF (`lib/exportar.ts`). No redibujar ni recolorear el logo; mínimos: logo
220 px, símbolo 64 px. Las facturas impresas de los clientes no llevan la marca de Empire (son documentos del cliente).

## Qué es

Software contable para empresas en República Dominicana, **pensado para venderse** a otras empresas (decisión de Joannie,
21-oct-2026). Primera versión con: contabilidad base, facturación y CxC, compras/CxP/bancos e impuestos DGII.

## Dónde vive

| Qué | Dónde |
|---|---|
| Código | GitHub `enfocatutalentord-cmyk/Contable-System` (cuenta personal, no organización; privado) |
| Rama de trabajo | `claude/gallant-bell-4ejogr` |
| Publicación | Vercel, proyecto `contable-system` (cuenta Hobby de enfocatutalentord) → https://contable-system.vercel.app |
| Base de datos | Neon (Postgres) conectada desde Vercel → Storage. Variable `DATABASE_URL` (se creó con el prefijo `DATABASE`). Vistas previas con rama de base propia. |
| Migraciones | `migraciones/*.sql`, se aplican solas en cada publicación de **producción** (`npm run vercel-build`). Las vistas previas no las aplican. |

Notas de infraestructura que costaron tiempo:
- El proyecto de Vercel se importó cuando el repo solo tenía el README y quedó como «Other». Por eso existe `vercel.json`
  con `"framework": "nextjs"` y `buildCommand: npm run vercel-build`. No quitarlo.
- Desde las sesiones en la nube de Claude no se llega a Vercel ni a sitios externos (la red lo bloquea): Joannie hace
  los pasos en Vercel y manda capturas.
- La app de Claude en GitHub no puede crear repositorios; Joannie los crea y les da acceso en
  https://github.com/apps/claude/installations/select_target.

## Arquitectura

- Next.js 16 (App Router, server actions) + TypeScript + Postgres con la librería `postgres`.
- **Aislamiento por empresa en la base (Row Level Security).** Toda operación contable pasa por `conEmpresa(empresaId, fn)`
  (`lib/db.ts`), que fija `app.empresa_id` y hace `SET LOCAL ROLE contable_app`. Ese rol no tiene BYPASSRLS (el dueño en Neon
  sí lo tiene; por eso existe el rol). `db()` a secas solo para lo que no es de una empresa (registro, sesiones, «mis empresas»).
- **Reglas contables en la base** (`migraciones/001_base.sql`): el asiento cuadra y tiene 2+ líneas (trigger diferido),
  solo cuentas de detalle activas de la misma empresa, nada se crea/cambia/anula en período cerrado (`empresas.fecha_bloqueo`,
  como las «lock dates» de Xero), los asientos no se borran (se anulan).
- Montos como texto `numeric(18,2)` y sumas en centavos con `bigint` (`lib/montos.ts`, `lib/calculos.ts`). Nunca floats.
- Asientos automáticos: `lib/asientos.ts` (`insertarAsiento`). Los asientos con `origen` distinto de `manual` solo se anulan
  anulando su documento.
- Sesiones: cookie httpOnly con token cuyo hash se guarda en `sesiones`; contraseñas con scrypt (`lib/auth.ts`).
- **Firmas** (`migraciones/003_plataforma.sql`): una firma contable (`firmas`) tiene clientes (`empresas.firma_id`), equipo
  (`miembros_firma`, con marca de administrador) y **perfiles** con permisos configurables (`perfiles.permisos`: ver, registrar,
  contabilizar, revertir, catálogo, cerrar, reabrir, adjuntar, exportar, auditoría, empresa, usuarios; `lib/permisos.ts`).
  Cada persona tiene un perfil por empresa (`miembros.perfil_id`). El administrador de la firma tiene todo en todas.
  `conEmpresa` también fija `app.usuario_id` para la auditoría; `conUsuario` para lo de la firma.
- **Estados del asiento:** borrador (editable, puede no cuadrar, sin número) → contabilizado (numerado, inmutable) ;
  «anulado» solo para asientos de documentos. Lo contabilizado se corrige con **reversión** (`revierte_a`), como Xero/QBO.
  Si la empresa tiene `requiere_aprobacion`, quien registra no contabiliza su propio asiento.
- **Auditoría:** trigger `auditar()` (SECURITY DEFINER) guarda en `auditoria` cada cambio con antes/después y usuario.
  Pantalla «Historial de cambios» e historial por asiento (`lib/auditoria.ts`).
- **Documentos de soporte:** tabla `documentos` (bytea, PDF/JPG/PNG ≤ 4 MB, tipo comprobado por contenido, retiro lógico).
- **Exportación:** Excel real (.xlsx, exceljs) y PDF (pdfmake con fuentes estándar) en `lib/exportar.ts`; CSV se mantiene.
- **Ventas y CxC** (`lib/ventas.ts`, `migraciones/005_ventas_fiscal.sql`): toda factura o nota de crédito nace como
  **borrador** (sin NCF ni asiento, editable, se puede descartar) y al **emitirse** toma el NCF y registra su asiento
  (como Draft → Approved de Xero). Emitir exige el permiso «contabilizar» y, con aprobación obligatoria, que no sea quien
  registró. Lo emitido no se modifica ni se borra (triggers `facturas_proteger` y `lineas_factura_proteger`): se anula o se
  corrige con nota de crédito (permiso «revertir»; usa la tasa de la factura original). Cada línea lleva sus impuestos en
  `impuestos_linea_factura` (ITBIS o exento + un cargo adicional como propina o selectivo), con la tasa aplicada. Las cuentas
  de impuestos salen de `impuestos.cuenta_ventas_id`; las retenciones del cobro, de `retenciones` (tabla `retenciones_cobro`,
  cuenta `cuenta_por_terceros_id`). Clientes con tipo de identificación, comprobante habitual y retenciones habituales.
  Tipos de venta: B01, B02, B14, B15, B16 y B04 (los e-CF llegan con la fase fiscal). Ya no hay módulo apagado.
- **Compras y CxP** (`lib/compras.ts`, `lib/cxp.ts`, `migraciones/006_compras.sql`): mismo esquema borrador → registrada.
  Comprobante del proveedor (B01, B02, B14, B15, E31, E32, E44, E45; notas B04/E34) o propio con nuestro rango (B11 compras a
  informales con cédula, B13 gastos menores, B17 pagos al exterior). **Control de duplicados:** índice único
  (empresa, proveedor, NCF) entre las no anuladas. Asiento: gasto/costo/activo (+ impuestos sin crédito) e ITBIS pagado
  (`impuestos.cuenta_compras_id`) contra CxP (`cxp` o `cxp_exterior`). B02/E32/B13, «ITBIS al costo» o empresa no
  contribuyente → el ITBIS va al gasto. Cada compra guarda el tipo de gasto del 606 (01–11) y cada línea si es bien o servicio;
  los pagos guardan la forma de pago del 606 (01–07) y las retenciones que hacemos (`retenciones_pago`, cuenta
  `cuenta_a_terceros_id`, con su código 606) en la fecha del pago. Registrar compras y hacer pagos exige «contabilizar».
  Cuentas en `cuentas_empresa`: `cxp` 210101, `cxp_exterior` 210102, `gasto_general` 610214 (Configuración de cuentas).
- **Configuración tributaria** (`lib/fiscal.ts`, `migraciones/004_tributaria.sql`): tablas `impuestos` y `retenciones` por empresa
  con tasa `numeric(7,4)`, cuentas asignadas (trigger: cuenta de detalle activa de la misma empresa) y vigencia desde/hasta, para
  que un cambio de ley (p. ej. Ley 30-26: ISR honorarios 10 % → 15 % desde 1-jul-2026) no altere lo anterior. Las retenciones de
  ITBIS son % del ITBIS facturado; las de ISR, % del monto sin impuestos. Cada línea puede llevar varios impuestos (ITBIS + propina).
  `configurar_tributaria(eid)` carga la configuración sugerida al crear una empresa. Catálogos de comprobantes (B01–B17, E31–E47)
  y obligaciones en `lib/fiscal.ts`; lo que la firma confirma se guarda en `obligaciones_empresa`. Pruebas: `pruebas/fiscal.test.mjs`.
  Pendiente de confirmar con un contador: tasas que no se cargaron por no estar claras tras la Ley 30-26 (p. ej. ISR de alquileres).
- **Respaldos:** `.github/workflows/respaldo.yml` (diario, pg_dump cifrado AES-256 con prueba de restauración). Necesita en
  GitHub → Settings → Secrets: `DATABASE_URL` (conexión directa de Neon, sin pooler) y `RESPALDO_CLAVE`. Ver `docs/respaldos.md`.

## Estado por fase

Orden aprobado por Joannie (22-oct-2026). Cada fase: presentar → desarrollar → mostrar pantallas → pruebas → pedir aprobación.
No se pasa a la siguiente sin su autorización expresa.

| Fase | Contenido | Estado |
|---|---|---|
| (antes) Base | Usuarios, empresas, catálogo dominicano, asientos, diario, mayor, balanza, cierres, CSV | En `main` y producción (`53ec121` + `ad104ee`) |
| 1. Plataforma y núcleo | Firmas con varios clientes, perfiles y permisos configurables, equipo de la firma, ficha de la empresa, borradores/contabilización/reversión, aprobación opcional, alerta de duplicados, documentos adjuntos, historial de cambios, búsqueda avanzada, Excel y PDF, respaldos | **Aprobada y en `main`** (22-oct-2026, commit `dd422f7`). |
| 2. Configuración tributaria | Perfil fiscal (persona física/jurídica, contribuyente de ITBIS, agente de retención, emisor e-CF), obligaciones DGII sugeridas y confirmables, impuestos con tasa, cuentas y vigencia, retenciones ITBIS/ISR con vigencia y tipo 606, todos los comprobantes B y E con sus rangos, «Probar cálculo» con asientos de ejemplo, permiso «impuestos» | **Aprobada y en `main`** (22-oct-2026, commit `3983185`; migración `004_tributaria.sql`; 34 pruebas; recorrido `pruebas/navegador/tributaria.cjs` de 11 pasos). |
| 3. Ventas y CxC | Borradores y emisión de facturas, impuestos de la configuración por línea (con propina/selectivo), notas de crédito B04, anulación 608, cobros con retenciones configurables y sugeridas, clientes con datos fiscales, productos con impuestos, adjuntos e historial en facturas y cobros, antigüedad y estado de cuenta | **Aprobada y en `main`** (22-oct-2026, commit `0a396a1`; migración `005_ventas_fiscal.sql`; 45 pruebas, 11 de ellas de ventas con la lógica real; recorrido `pruebas/navegador/ventas.cjs` de 13 pasos; los de las fases 1 y 2 siguen pasando). |
| 4. Compras y CxP | Proveedores con datos fiscales y valores habituales, compras en borrador y registradas con NCF del proveedor o propio (B11, B13, B17), control de NCF duplicados, ITBIS con crédito o al costo, notas de crédito del proveedor, pagos con retenciones sugeridas y diferencia cambiaria, antigüedad y estado de cuenta de proveedores, datos del 606, adjuntos e historial | **Aprobada y en `main`** (23-oct-2026, commit `617f33a`; migración `006_compras.sql`; 56 pruebas, 11 de compras con la lógica real; recorrido `pruebas/navegador/compras.cjs` de 11 pasos; los de las fases 1 a 3 siguen pasando). |
| 5. Bancos | Importación de estados de cuenta y conciliación con reglas | Pendiente |
| 6. Fiscal | 606–609, IT-1, ISR, IR-17; e-CF por proveedor certificado (PSFE) | Pendiente |
| 7. Estados financieros y reportes | Resultados, balance, flujo, comparativos; Excel y PDF | Pendiente |

### Pendientes y decisiones abiertas

- Publicado en `main` el 22-oct-2026: la migración 003 convierte a cada dueño actual en una firma con sus empresas
  (Goemhy queda en una firma con el nombre de Manaury). Confirmar con Joannie la publicación en Vercel (captura de Deployments).
- Fase 4 publicada el 23-oct-2026 (Joannie confirmó en Vercel: c49b62b Ready). Siguiente: Fase 5 (Bancos), solo con autorización expresa.
- Preguntar a Joannie: ¿qué firma usará el sistema (Empire, Enfoca o se vende a muchas)? ¿Goemhy sigue como primer cliente?
- Antes de producción: secretos de respaldo en GitHub (`DATABASE_URL` directa y `RESPALDO_CLAVE`) y activar PITR en Neon.
- **Factura electrónica (e-CF):** obligatoria por etapas en 2026 (Ley 32-23). Recomendado: conectarse a un proveedor ya
  certificado por la DGII (PSFE) en vez de certificarse. Joannie aún no lo ha confirmado.
- Después de la Fase 2: enviar la factura por correo, anticipos de clientes (cobrar antes de facturar).
- Seguridad: recuperar contraseña por correo y limitar intentos de entrada (hoy el dueño da una clave temporal y la persona
  la cambia en «Mi cuenta»).
- Antes de facturar de verdad, cada empresa debe cargar sus rangos de NCF autorizados en «Comprobantes NCF».

## Cómo trabajar en local

```bash
service postgresql start            # en la nube de Claude hay Postgres 16 instalado
su postgres -c "psql -c \"CREATE ROLE contable LOGIN PASSWORD 'contable' CREATEDB CREATEROLE;\" -c \"CREATE DATABASE contable OWNER contable;\""
echo 'DATABASE_URL=postgres://contable:contable@localhost:5432/contable' > .env.local
npm install
DATABASE_URL=postgres://contable:contable@localhost:5432/contable npm run migrar
DATABASE_URL=postgres://contable:contable@localhost:5432/contable npm test   # 56 pruebas (base, montos, cálculos, fiscal, ventas y compras)
npm run build && npx next start -p 3100
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/fase1.cjs   # recorridos completos (base vacía)
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/tributaria.cjs   # crea su propia firma
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/ventas.cjs       # crea su propia firma
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/compras.cjs      # crea su propia firma
```

Ojo: con FORCE RLS, consultar las tablas con `psql` como dueño devuelve 0 filas si no se fija antes
`SELECT set_config('app.empresa_id', '<uuid>', true)` dentro de una transacción.

## Otros proyectos de esta misma línea de trabajo

- **empire-web** (`enfocatutalentord-cmyk/empire-web`): web de Empire Tax’N Legal, publicada en
  https://www.empiretaxnlegal.com.do. Su estado está en el `CLAUDE.md` de ese repositorio.
- `enfoca-panel` y `enfoca-talent-intelligence-platform`: Joannie pidió **no tocarlos** en esta línea de trabajo.
