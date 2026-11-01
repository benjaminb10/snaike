/** Adresse du serveur de jeu : VITE_WS_URL, sinon le port 5289 en dev, sinon la même origine. */
export function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  if (import.meta.env.DEV) return `ws://${location.hostname}:5289/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
