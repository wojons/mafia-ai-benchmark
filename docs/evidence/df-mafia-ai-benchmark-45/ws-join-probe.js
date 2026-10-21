// DF-MAFIA-AI-BENCHMARK-45 WS verifier: connect, wait for handshake CONNECTED,
// then send the documented frame {type:'JOIN_GAME', payload:{gameId}} and
// record the first protocol reply to it. Expects GAME_JOINED,
// not 'Invalid message format'.
const WebSocket = require('/home/kara/worktrees/mafia-ai-benchmark-DF-MAFIA-AI-BENCHMARK-45/apps/server/node_modules/ws');
const gameId = process.env.gameList;
const ws = new WebSocket('ws://localhost:3004/ws');
let sent = false;
const timeline = [];
const firstReply = new Promise((resolve, reject) => {
  const t = setTimeout(() => { ws.terminate(); reject(new Error('timeout 15s')); }, 15000);
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    timeline.push(msg.type);
    if (!sent && msg.type === 'CONNECTED') {
      sent = true;
      ws.send(JSON.stringify({ type: 'JOIN_GAME', payload: { gameId } }));
      return; // keep listening; resolve on the NEXT frame = reply to our JOIN
    }
    if (sent) {
      clearTimeout(t);
      resolve(JSON.stringify(msg) + ' | timeline=' + timeline.join('->'));
      ws.close();
    }
  });
  ws.on('error', (e) => { clearTimeout(t); reject(e); });
});
firstReply.then((reply) => {
  console.log('GID=' + gameId);
  console.log('FIRST_REPLY_AFTER_JOIN=' + reply);
  process.exit(reply.includes('GAME_JOINED') ? 0 : 1);
}).catch((e) => { console.error('PROBE_ERROR=' + e.message); process.exit(2); });