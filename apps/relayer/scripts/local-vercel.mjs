// Prueba local de la lógica de la función de Vercel (api/index.ts) sin desplegar: la monta en un servidor HTTP normal.
// Aviso: en local el cuerpo de la petición llega completo; Vercel tiene su propio manejo del cuerpo, que solo se
// comprueba de verdad en un despliegue (ver README, "Despliegue en Vercel").
// Uso: node --env-file-if-exists=.env --import tsx scripts/local-vercel.mjs [puerto]
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';

const { default: handler } = await import('../api/index.ts');
const port = Number(process.argv[2] ?? 8790);
createServer(getRequestListener((request) => handler.fetch(request))).listen(port, () =>
  console.log(`Función de Vercel (lógica) en http://localhost:${port}`),
);
