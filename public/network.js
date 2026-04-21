export function connect(name, passcode, handlers) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => ws.send(JSON.stringify({ type: 'login', name, passcode }));

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    handlers[msg.type]?.(msg);
  };

  ws.onclose = () => handlers.close?.();
  ws.onerror = () => handlers.error?.();

  const send = msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  return { send, close: () => ws.close() };
}
