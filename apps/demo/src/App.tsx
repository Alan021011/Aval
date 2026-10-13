import { useState } from 'react';
import { AgentTaskView, type TaskResult } from './components/AgentTask';
import { ApprovalsView } from './components/Approvals';
import { InspectorView } from './components/Inspector';
import { MemoryView } from './components/Memory';
import { Landing, Preparing } from './components/Onboarding';
import { PanelView } from './components/Panel';
import { PermitView } from './components/Permit';
import { ReceiptsView } from './components/Receipts';
import { BottomNav, Footer, Header, Locked, Sidebar, TestnetNote, Toast } from './components/Shell';
import { type Route, useRoute } from './lib/router';
import { type App as AppState, useAval } from './state/useAval';
import { type Memory, useMemory } from './state/useMemory';

function View({ route, app, memory, task, setTask }: { route: Route; app: AppState; memory: Memory; task: TaskResult | null; setTask: (r: TaskResult | null) => void }) {
  switch (route) {
    case 'permiso':
      return <PermitView app={app} />;
    case 'agente':
      return <AgentTaskView app={app} memory={memory} result={task} setResult={setTask} />;
    case 'aprobaciones':
      return <ApprovalsView app={app} />;
    case 'recibos':
      return <ReceiptsView app={app} />;
    case 'memoria':
      return <MemoryView app={app} memory={memory} />;
    case 'inspector':
      return <InspectorView app={app} memory={memory} />;
    default:
      return <PanelView app={app} memory={memory} />;
  }
}

export default function App() {
  const app = useAval();
  const memory = useMemory(app);
  const route = useRoute();
  // La última tarea de Qwen vive aquí para que no se pierda al cambiar de vista.
  const [task, setTask] = useState<TaskResult | null>(null);

  const signedIn = (app.phase === 'in' || app.phase === 'locked') && !!app.snapshot;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header app={app} route={route} signedIn={signedIn} />

      {signedIn ? (
        <div className="mx-auto flex w-full max-w-[1280px] flex-1">
          <Sidebar route={route} pending={app.pending.length} />
          <main id="contenido" className="min-w-0 flex-1 px-4 pt-5 pb-8 md:px-6 md:pt-6 lg:pb-10">
            <TestnetNote />
            {app.phase === 'locked' ? <Locked app={app} /> : null}
            <View route={route} app={app} memory={memory} task={task} setTask={setTask} />
          </main>
        </div>
      ) : (
        <main id="contenido" className="flex-1">
          {app.phase === 'working' ? (
            <Preparing app={app} />
          ) : route === 'inspector' ? (
            <div className="mx-auto max-w-[1080px] px-4 py-6 md:px-8">
              <InspectorView app={app} />
            </div>
          ) : (
            <Landing app={app} />
          )}
        </main>
      )}

      {signedIn ? <BottomNav route={route} pending={app.pending.length} /> : null}
      <Toast app={app} />
      <div className={signedIn ? 'pb-20 lg:pb-0' : ''}>
        <Footer />
      </div>
    </div>
  );
}
