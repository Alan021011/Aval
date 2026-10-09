import type { Hono } from 'hono';
import { createFromEnv } from '../src/bootstrap.js';

/**
 * Entrada para Vercel: una función Node con el formato estándar de Web (`fetch(request)`), que atiende todas las
 * rutas del relayer.
 *
 * Importante: NO usar el formato clásico `(req, res)` con `getRequestListener`. Vercel lee el cuerpo de la petición
 * antes de llamar a la función, y el adaptador se queda esperando datos que ya no llegan: los POST se cuelgan hasta
 * que Vercel los corta a los 300 s. Con `fetch(request)` la petición llega completa.
 *
 * La app se construye al primer pedido (no al cargar el módulo), para que una variable de entorno que falte se vea
 * como un error claro en la respuesta y en los registros, y no como una función que no arranca.
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

export default {
  async fetch(request: Request): Promise<Response> {
    const current = getApp();
    if (!current) {
      return new Response(
        JSON.stringify({ error: { code: 'ServerMisconfigured', message: 'El relayer no está configurado.' } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
    return current.fetch(request);
  },
};
