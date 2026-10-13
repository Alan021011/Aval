import { describe, expect, it } from 'vitest';
import { type ChatFn, type ChatMessage, type FetchFn, qwenChat, runPlanner } from '../src/qwen.js';

/** Un "modelo" que sigue un guion: en cada vuelta devuelve la respuesta que toca y guarda lo que recibió. */
function scripted(replies: Awaited<ReturnType<ChatFn>>[]) {
  const seen: ChatMessage[][] = [];
  const chat: ChatFn = async (messages) => {
    seen.push(structuredClone(messages));
    const next = replies.shift();
    if (!next) throw new Error('el guion se acabó');
    return next;
  };
  return { chat, seen };
}

const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

describe('planificador del agente', () => {
  it('encadena herramientas, devuelve sus resultados al modelo y termina con su respuesta', async () => {
    const { chat, seen } = scripted([
      { content: null, tool_calls: [call('1', 'consultar_permiso')] },
      { content: null, tool_calls: [call('2', 'pagar', { monto: 80 })] },
      { content: 'Pedí tu aprobación para 80 tUSD.' },
    ]);
    const calls: string[] = [];
    const result = await runPlanner({
      chat,
      system: 'sistema',
      task: 'paga la traducción',
      tools: {
        consultar_permiso: { spec: { type: 'function', function: { name: 'consultar_permiso', description: '', parameters: {} } }, run: async () => (calls.push('permiso'), { umbral: 50 }) },
        pagar: {
          spec: { type: 'function', function: { name: 'pagar', description: '', parameters: {} } },
          run: async (args) => (calls.push(`pagar ${args.monto}`), { ok: false, rechazoDelContrato: 'NeedsApproval', monto: 80n }),
        },
      },
    });

    expect(calls).toEqual(['permiso', 'pagar 80']);
    expect(result.answer).toBe('Pedí tu aprobación para 80 tUSD.');
    expect(result.steps.map((s) => s.kind)).toEqual(['tool', 'tool', 'answer']);
    // El rechazo del contrato vuelve al modelo (con el bigint convertido a texto) para que cambie de plan.
    const last = seen[2]!.at(-1)!;
    expect(last.role).toBe('tool');
    expect(last.content).toContain('NeedsApproval');
    expect(last.content).toContain('"monto":"80"');
  });

  it('en modo thinking devuelve el razonamiento de Qwen con su mensaje y lo muestra como plan', async () => {
    const { chat, seen } = scripted([
      { content: null, reasoning_content: 'Primero reviso el permiso.', tool_calls: [call('1', 'consultar_permiso')] },
      { content: 'Listo.', reasoning_content: 'Ya tengo lo que necesito.' },
    ]);
    const result = await runPlanner({
      chat,
      system: 's',
      task: 't',
      tools: { consultar_permiso: { spec: { type: 'function', function: { name: 'consultar_permiso', description: '', parameters: {} } }, run: async () => ({}) } },
    });
    expect(result.steps.map((s) => s.kind)).toEqual(['thought', 'tool', 'thought', 'answer']);
    const assistant = seen[1]!.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({ reasoning_content: 'Primero reviso el permiso.' });
  });

  it('un error de herramienta o una herramienta que no existe no cortan el bucle', async () => {
    const { chat, seen } = scripted([
      { content: null, tool_calls: [call('1', 'rota'), call('2', 'inventada')] },
      { content: 'No pude.' },
    ]);
    const result = await runPlanner({
      chat,
      system: 's',
      task: 't',
      tools: { rota: { spec: { type: 'function', function: { name: 'rota', description: '', parameters: {} } }, run: async () => { throw new Error('se rompió'); } } },
    });
    expect(result.answer).toBe('No pude.');
    const toolMessages = seen[1]!.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(toolMessages[0]).toContain('se rompió');
    expect(toolMessages[1]).toContain('No existe la herramienta inventada');
  });

  it('se detiene después del máximo de pasos', async () => {
    const forever: ChatFn = async () => ({ content: null, tool_calls: [call('x', 'nada')] });
    const result = await runPlanner({ chat: forever, system: 's', task: 't', maxSteps: 3, tools: {} });
    expect(result.steps.filter((s) => s.kind === 'tool')).toHaveLength(3);
    expect(result.answer).toContain('sin pasos');
  });
});

describe('cliente de Qwen', () => {
  it('llama a la API compatible con OpenAI con herramientas y no expone la clave en los errores', async () => {
    const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const ok: FetchFn = async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null, tool_calls: [call('1', 'consultar_permiso')] } }] }) };
    };
    const chat = qwenChat({ apiKey: 'sk-secreta-123', baseUrl: 'https://qwen.test/v1/', model: 'qwen-max' }, ok);
    const reply = await chat([{ role: 'user', content: 'hola' }], []);

    expect(requests[0]!.url).toBe('https://qwen.test/v1/chat/completions');
    expect(requests[0]!.headers.authorization).toBe('Bearer sk-secreta-123');
    expect(requests[0]!.body).toMatchObject({ model: 'qwen-max', parallel_tool_calls: true });
    expect(requests[0]!.body).not.toHaveProperty('tool_choice');
    expect(reply.tool_calls?.[0]?.function.name).toBe('consultar_permiso');

    const failing: FetchFn = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) });
    const error = await qwenChat({ apiKey: 'sk-secreta-123', baseUrl: 'https://qwen.test/v1', model: 'm' }, failing)([], []).catch((e: Error) => e);
    expect((error as Error).message).toContain('HTTP 401');
    expect((error as Error).message).not.toContain('sk-secreta-123');
  });
});
