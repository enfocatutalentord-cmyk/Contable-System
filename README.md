# Contable-System

Sistema contable para empresas en República Dominicana. Next.js + TypeScript + Postgres, publicado en Vercel.

## Fase 1 (base)

- Cuentas de usuario y varias empresas por usuario, con roles: dueño, contador, auxiliar y solo lectura.
- Catálogo de cuentas dominicano por niveles (clase, grupo, subgrupo, detalle), ampliable con subcuentas.
- Asientos de diario con número consecutivo, validación de cuadre y anulación con motivo (no se borran).
- Libro diario, libro mayor y balanza de comprobación, con descarga para Excel.
- Cierres de período con fecha de bloqueo (como las «lock dates» de Xero) e historial.

## Fase 2 (ventas y cuentas por cobrar)

- Clientes (con RNC o cédula y días de crédito) y servicios con precio, ITBIS (18 %, 16 % o exento) y cuenta de ingreso.
- Rangos de NCF autorizados por la DGII (B01, B02, B14, B15 y B04) con vencimiento; cada factura toma el siguiente.
- Facturas en pesos o dólares, imprimibles, con asiento automático (cuentas por cobrar contra ingresos e ITBIS).
- Notas de crédito B04 que rebajan el saldo de la factura, y anulación con los motivos del formato 608.
- Cobros a una o varias facturas con retención de ITBIS e ISR, diferencia cambiaria y recibo imprimible.
- Antigüedad de saldos a cualquier fecha y estado de cuenta por cliente, con descarga para Excel.
- Configuración de las cuentas que usan los asientos automáticos.

### Seguridad de los datos

- Cada empresa está aislada en la base con Row Level Security: la app trabaja con el rol `contable_app`,
  que solo ve la empresa en curso.
- Las reglas contables las hace cumplir la base aunque la app falle: el asiento debe cuadrar, solo cuentas de
  detalle activas, nada se crea, cambia ni anula en un período cerrado, y los asientos no se borran.
- Contraseñas con scrypt; sesiones en cookie httpOnly guardadas como hash.

## Desarrollo

```bash
cp .env.example .env.local   # y pon tu DATABASE_URL
npm install
npm run migrar
npm run dev
```

Pruebas (usan la base de `DATABASE_URL` y limpian lo que crean):

```bash
npm test
```

## Publicación en Vercel

1. En el proyecto de Vercel: **Storage → Create Database → Neon (Postgres)** y conéctala al proyecto.
   Eso crea `DATABASE_URL` en las variables de entorno.
2. Cada publicación de producción aplica las migraciones pendientes (`vercel-build`) antes de compilar.
   Las vistas previas no tocan la base de producción.
