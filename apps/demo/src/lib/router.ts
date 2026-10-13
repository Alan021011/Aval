import { useEffect, useState } from 'react';

/** Las vistas de la app. Se navega con el hash (`#/permiso`) para que funcione en cualquier hosting estático. */
export const ROUTES = ['panel', 'permiso', 'agente', 'aprobaciones', 'recibos', 'memoria', 'inspector'] as const;
export type Route = (typeof ROUTES)[number];

export const href = (route: Route) => `#/${route}`;

function read(): Route {
  const name = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (ROUTES as readonly string[]).includes(name ?? '') ? (name as Route) : 'panel';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function go(route: Route) {
  window.location.hash = `/${route}`;
}
