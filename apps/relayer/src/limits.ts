import type { Address } from 'viem';

/** Reglas que protegen los fondos del relayer: sin ellas, cualquiera podría gastarle el gas. */
export type Limits = {
  /** Solicitudes por minuto desde una misma IP. */
  perIpPerMinute: number;
  /** Operaciones por minuto de un mismo usuario (o permiso). */
  perOwnerPerMinute: number;
  /** Transacciones que el relayer envía en total cada 24 horas. */
  maxTransactionsPerDay: number;
  /** Si el saldo baja de esto, el relayer deja de enviar y avisa, en vez de vaciarse. */
  minBalanceWei: bigint;
  /** Igual, para la cuenta del agente de demostración, que gasta mucho menos gas que el relayer. */
  agentMinBalanceWei: bigint;
  /** Tokens con los que el relayer acepta trabajar. */
  allowedTokens: Address[];
  /** Tamaño máximo de una solicitud. */
  maxBodyBytes: number;
  /** TUSD que entrega el faucet por pedido (en unidades del token). */
  faucetAmount: bigint;
  /** Segundos que debe esperar una dirección (o IP) entre pedidos al faucet. */
  faucetCooldownSeconds: number;
  /** Veces que se reintenta un envío que chocó con otra transacción de la misma cuenta (otra instancia del servicio). */
  maxNonceRetries: number;
};

export class RelayerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    /** Datos del error del contrato (por ejemplo, el monto y el límite superado), para que el cliente los explique. */
    readonly args: readonly unknown[] = [],
  ) {
    super(message);
    this.name = 'RelayerError';
  }
}

/** Ventana deslizante en memoria. Con varias instancias del servicio hay que moverla a un almacén compartido. */
export class SlidingWindow {
  private hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  /** Registra un intento. Si ya se alcanzó el límite, no lo cuenta y devuelve cuántos segundos faltan. */
  hit(key: string, limit: number, now: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.sweep(now);
    return { ok: true };
  }

  private lastSweep = 0;
  /** Limpia claves viejas de vez en cuando para que la memoria no crezca sin límite. */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Cuenta cuántas transacciones se enviaron en las últimas 24 horas. */
export class DailyCounter {
  private times: number[] = [];

  constructor(private readonly windowMs = 24 * 60 * 60 * 1000) {}

  count(now: number): number {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    return this.times.length;
  }

  add(now: number) {
    this.times.push(now);
  }
}

export const defaultLimits = (allowedTokens: Address[]): Limits => ({
  perIpPerMinute: 30,
  perOwnerPerMinute: 10,
  maxTransactionsPerDay: 2000,
  minBalanceWei: 500_000_000_000_000_000n, // 0,5 MON
  agentMinBalanceWei: 50_000_000_000_000_000n, // 0,05 MON
  allowedTokens,
  maxBodyBytes: 16 * 1024,
  faucetAmount: 500_000_000n, // 500 tUSD
  faucetCooldownSeconds: 3600,
  maxNonceRetries: 6,
});
