// NOTIFY wakes every replica; consumers re-read committed rows and permissions.
// A periodic resync makes missed notifications recoverable after reconnect.
export async function createEventBus(pool) {
  const callbacks = new Map();
  let client;
  let stopped = false;
  let retry;
  async function connect() {
    if (stopped) return;
    try {
      client = await pool.connect();
      await client.query("LISTEN rayo_events");
      client.on("notification", (msg) => {
        try {
          const data = JSON.parse(msg.payload);
          for (const cb of callbacks.get(msg.channel) || [])
            Promise.resolve(cb(data)).catch(() => {});
        } catch {}
      });
      client.on("error", () => {
        client?.release(true);
        client = null;
        if (!stopped) retry = setTimeout(connect, 1000);
      });
    } catch {
      client?.release(true);
      client = null;
      if (!stopped) retry = setTimeout(connect, 1000);
    }
  }
  await connect();
  return {
    async publish(channel, payload) {
      if (channel !== "rayo_events") throw Error("Canal no permitido");
      await pool.query("SELECT pg_notify($1,$2)", [
        channel,
        JSON.stringify(payload),
      ]);
    },
    async subscribe(channel, callback) {
      if (channel !== "rayo_events") throw Error("Canal no permitido");
      const set = callbacks.get(channel) || new Set();
      set.add(callback);
      callbacks.set(channel, set);
      return async () => set.delete(callback);
    },
    async close() {
      stopped = true;
      clearTimeout(retry);
      callbacks.clear();
      if (client) {
        await client.query("UNLISTEN *").catch(() => {});
        client.release();
        client = null;
      }
    },
  };
}
