/**
 * Cliente de Qwen (API compatible con OpenAI de Alibaba Cloud Model Studio) y un planificador de varios pasos con
 * herramientas. El planificador no sabe nada de Qwen: recibe una función `chat`, así se prueba con un modelo simulado.
 */

export type QwenConfig = {
  apiKey: string;
  /** Por ejemplo, https://dashscope-intl.aliyuncs.com/compatible-mode/v1 */
  baseUrl: string;
  model: string;
};

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatReply = { content: string | null; tool_calls?: ToolCall[] };
export type ChatFn = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ChatReply>;

export type FetchFn = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Llamada a Qwen con herramientas. La clave nunca se registra ni se devuelve en los errores. */
export function qwenChat(config: QwenConfig, fetchFn: FetchFn = (url, init) => fetch(url, init)): ChatFn {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return async (messages, tools) => {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: ChatReply }[];
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(`Qwen respondió HTTP ${response.status}: ${body.error?.message ?? 'sin detalle'}`);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error('Qwen no devolvió ningún mensaje.');
    return { content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  };
}

export type Tool = { spec: ToolSpec; run(args: Record<string, unknown>): Promise<unknown> };

export type Step =
  | { kind: 'tool'; name: string; args: Record<string, unknown>; result: unknown }
  | { kind: 'answer'; text: string };

/** JSON que acepta bigint (los montos de la cadena). */
const toJson = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

/**
 * Bucle de agente: el modelo decide qué herramienta usar, se ejecuta, el resultado vuelve al modelo y así hasta que
 * responde sin pedir herramientas (o se acaban los pasos). Los errores de una herramienta no cortan el bucle: vuelven
 * al modelo como resultado, para que cambie de plan (por ejemplo, ante un rechazo del contrato).
 */
export async function runPlanner(options: {
  chat: ChatFn;
  tools: Record<string, Tool>;
  system: string;
  task: string;
  maxSteps?: number;
}): Promise<{ steps: Step[]; answer: string }> {
  const specs = Object.values(options.tools).map((t) => t.spec);
  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.task },
  ];
  const steps: Step[] = [];

  for (let round = 0; round < (options.maxSteps ?? 8); round++) {
    const reply = await options.chat(messages, specs);
    if (!reply.tool_calls?.length) {
      const answer = reply.content?.trim() || 'Listo.';
      steps.push({ kind: 'answer', text: answer });
      return { steps, answer };
    }
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      let result: unknown;
      try {
        args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        const tool = options.tools[call.function.name];
        result = tool ? await tool.run(args) : { error: `No existe la herramienta ${call.function.name}.` };
      } catch (error) {
        result = { error: error instanceof Error ? error.message : 'Error desconocido en la herramienta.' };
      }
      steps.push({ kind: 'tool', name: call.function.name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: toJson(result) });
    }
  }
  const answer = 'Me quedé sin pasos antes de terminar. Revisa lo que hice arriba.';
  steps.push({ kind: 'answer', text: answer });
  return { steps, answer };
}
