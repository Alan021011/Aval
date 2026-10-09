import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';
import { createFromEnv } from '../src/bootstrap.js';

/**
 * Entrada para Vercel: una función Node que atiende todas las rutas del relayer.
 * Se construye al primer pedido (no al cargar el módulo), para que una variable de entorno que falte se vea como un
 * error claro en la respuesta y en los registros, y no como una función que no arranca.
 */
let app: Hono | undefined;
let failure: string | undefined;

function getApp(): Hono | undefined {
  if (app || failure) return app;
  try {
    app = createFromEnv().app;
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Configuración inválida';
    console.error('[relayer] no pudo arrancar:', failure);
  }
  return app;
}

export default getRequestListener(async (request) => {
  const current = getApp();
  if (!current) {
    return new Response(JSON.stringify({ error: { code: 'ServerMisconfigured', message: 'El relayer no está configurado.' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  return current.fetch(request);
});
