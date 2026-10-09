import { USD } from './config';

/** 20_000000n → "20", 1_500000n → "1,5". Sin ceros sobrantes. */
export function usd(amount: bigint): string {
  const whole = amount / USD;
  const cents = amount % USD;
  if (cents === 0n) return whole.toLocaleString('es');
  const decimals = (Number(cents) / Number(USD)).toFixed(2).slice(2).replace(/0+$/, '');
  return `${whole.toLocaleString('es')},${decimals}`;
}

/** Texto del usuario → unidades del token. Acepta coma o punto. `null` si no es un número válido y positivo. */
export function parseUsd(text: string): bigint | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  const amount = BigInt(whole) * USD + BigInt(frac.padEnd(6, '0'));
  return amount > 0n ? amount : null;
}

export const shortHash = (hash: string, edge = 6) => `${hash.slice(0, edge + 2)}…${hash.slice(-edge)}`;

/** "hace 5 s", "hace 3 min", "hace 2 h". */
export function ago(seconds: number | bigint, now = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000 - Number(seconds)));
  if (diff < 5) return 'ahora mismo';
  if (diff < 60) return `hace ${diff} s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

/** "23 h 58 min", "4 min", "vencido". */
export function remainingTime(untilSeconds: bigint, now = Date.now()): string {
  const diff = Number(untilSeconds) - Math.floor(now / 1000);
  if (diff <= 0) return 'vencido';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${Math.max(1, minutes)} min`;
}

export const seconds = (ms: number) => (ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 });
