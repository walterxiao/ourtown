export function connect(name, passcode, handlers) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}`;
  console.log('[ourtown] opening WebSocket:', url);
  const ws = new WebSocket(url);

  ws.onopen = () => {
    handlers.open?.();
    ws.send(JSON.stringify({ type: 'login', name, passcode }));
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    console.log('[ourtown] ws msg <-', msg.type);
    handlers[msg.type]?.(msg);
  };

  ws.onclose = (ev) => handlers.close?.(ev);
  ws.onerror = (ev) => handlers.error?.(ev);

  const send = msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  return { send, close: () => ws.close() };
}
