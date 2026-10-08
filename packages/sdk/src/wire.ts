/**
 * Formato de transporte: JSON que conserva los `bigint`. Las firmas que se envían a un relayer contienen montos y
 * fechas como `bigint`, que `JSON.stringify` no soporta.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v));
}

/** Inversa de `serialize`. Lanza si el texto no es JSON o si algún `$bigint` no es un entero. */
export function deserialize<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$bigint' && typeof v.$bigint === 'string') return BigInt(v.$bigint);
    }
    return v;
  }) as T;
}
