// Prueba local de la función de Vercel (api/index.ts) sin desplegar: la monta en un servidor HTTP normal.
// Uso: node --env-file-if-exists=.env --import tsx scripts/local-vercel.mjs [puerto]
import { createServer } from 'node:http';

const { default: handler } = await import('../api/index.ts');
const port = Number(process.argv[2] ?? 8790);
createServer(handler).listen(port, () => console.log(`Función de Vercel en http://localhost:${port}`));
