// Genera src/abi.ts a partir de la compilación de Foundry, para que el SDK nunca se desincronice de los contratos.
// Uso: (en contracts/) forge build && (en packages/sdk/) npm run gen:abi
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const salida = join(aquí, '..', '..', '..', 'contracts', 'out');
const contratos = ['PasskeyRegistry', 'AgentPermit', 'ReputationReader', 'TestUSD'];

let texto = '// Generado por scripts/gen-abi.mjs desde la compilación de Foundry. No editar a mano.\n\n';
for (const nombre of contratos) {
  const { abi } = JSON.parse(readFileSync(join(salida, `${nombre}.sol`, `${nombre}.json`), 'utf8'));
  const útil = abi.filter((x) => x.type !== 'constructor');
  const variable = { TestUSD: 'testUsd' }[nombre] ?? nombre.charAt(0).toLowerCase() + nombre.slice(1);
  const exportado = variable + 'Abi';
  texto += `export const ${exportado} = ${JSON.stringify(útil, null, 2)} as const;\n\n`;
}
writeFileSync(join(aquí, '..', 'src', 'abi.ts'), texto);
console.log('src/abi.ts generado con', contratos.length, 'contratos');
