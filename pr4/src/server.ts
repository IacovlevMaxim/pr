import express, { Request, Response } from 'express';
import axios from 'axios';
import Mutex from './Mutex';
import http from 'http';
import https from 'https';
import { getNextVersion, replicateToFollower }  from "./utils";

const app = express();
app.use(express.json());

type StoreEntry = { value: any; version: number };
const store: Map<string, StoreEntry> = new Map();
const keyLocks = new Map<string, Mutex>();

function getKeyLock(key: string): Mutex {
  if (!keyLocks.has(key)) {
    keyLocks.set(key, new Mutex());
  }
  return keyLocks.get(key)!;
}

const ROLE = process.env.ROLE || 'follower';
const PORT = Number(process.env.PORT || '5000');

const FOLLOWERS = (process.env.FOLLOWERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MIN_DELAY_MS = Number(process.env.MIN_DELAY || '0');
const MAX_DELAY_MS = Number(process.env.MAX_DELAY || '1000');
let WRITE_QUORUM = Number(process.env.WRITE_QUORUM || '1');
const REPL_TIMEOUT = Number(process.env.REPL_TIMEOUT || '2000');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const sharedClient = axios.create({ httpAgent, httpsAgent });

async function writeLocal(key: string, value: any, version: number) {
  const lock = getKeyLock(key);
  const release = await lock.lock();
  try {
    const current = store.get(key) ?? { value: null, version: 0 };
    if (version >= current.version) {
      store.set(key, { value, version });
    }
  } finally {
    release();
  }
}

async function readLocal(key: string) {
  const lock = getKeyLock(key);
  const release = await lock.lock();
  try {
    const entry = store.get(key);
    return entry ? entry.value : null;
  } finally {
    release();
  }
}

app.get('/get/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  const val = await readLocal(key);
  if (val === null || val === undefined) {
    res.status(404).json({ found: false });
  } else {
    res.status(200).json({ found: true, value: val });
  }
});

app.post('/replicate', async (req: Request, res: Response) => {
  const body = req.body;
  if (!body || body.key === undefined || body.value === undefined || body.version === undefined) {
    return res.status(400).json({ error: 'bad request' });
  }
  const { key, value, version } = body;
  await writeLocal(key, value, Number(version));
  return res.status(200).json({ status: 'ok' });
});

app.post('/put/:key', async (req: Request, res: Response) => {
  if (ROLE !== 'leader') {
    return res.status(403).json({ error: 'not leader' });
  }

  const key = req.params.key;
  const body = req.body;
  if (!body || body.value === undefined) {
    return res.status(400).json({ error: 'bad request' });
  }

  const value = body.value;
  const version = await getNextVersion();
  await writeLocal(key, value, version);

  const required = WRITE_QUORUM;

  // Creating a shared client instead of making a new one every time to save time 
  const client = sharedClient; //axios.create({ timeout: REPL_TIMEOUT });

  // Start replication requests
  let confirmations = 0;
  let finished = false;

  return await new Promise<Response | void>((resolve) => {
    // Initially had an array of aborts
    // const controllers: AbortController[] = [];
    const pending: Promise<void>[] = [];

    // timeout to wait for quorum (give a small grace over REPL_TIMEOUT)
    const overallTimeoutMs = REPL_TIMEOUT + 200; // adjust if needed
    const overallTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        
        // If the quorum did not finish on time, abort remaining requests to save resources
        // This turned out to be very slow (overhead ~= 200ms) for low quorum
        // for (const c of controllers) {
        //   try { c.abort(); } catch { /* ignore */ }
        // }
        resolve(res.status(500).json({ status: 'error', replicas_confirmed: confirmations, reason: 'quorum not reached (timeout)' }));
      }
    }, overallTimeoutMs);

    for (const f of FOLLOWERS) {
      // create controller for this request to be able to abort it later
    //   const ctrl = new AbortController();
    //   controllers.push(ctrl);

      const p = replicateToFollower(client, f, key, value, version //, ctrl.signal
      ).then((ok) => {
        if (finished) return;
        if (ok) {
          confirmations += 1;
          if (confirmations >= required && !finished) {
            finished = true;
            clearTimeout(overallTimer);
            // abort remaining requests to reduce load (counter-productive)
            // for (const c of controllers) {
            //   try { c.abort(); } catch { /* ignore */ }
            // }
            resolve(res.status(200).json({ status: 'ok', replicas_confirmed: confirmations }));
          }
        }
      }).catch(() => {
        /* tolerate per-follower errors */
      });

      pending.push(p);
    }
  });
});

app.post('/admin/set_quorum', (req: Request, res: Response) => {
  if (ROLE !== 'leader') return res.status(403).json({ error: 'not leader' });
  const body = req.body;

  if (!body || body.quorum === undefined) return res.status(400).json({ error: 'bad request' });
  WRITE_QUORUM = Number(body.quorum);

  return res.status(200).json({ status: 'ok', write_quorum: WRITE_QUORUM });
});

app.get('/admin/get_quorum', (req: Request, res: Response) => {
  return res.status(200).json({ write_quorum: WRITE_QUORUM });
});

app.get('/admin/store', async (req: Request, res: Response) => {
  // Snapshot the store by acquiring all key locks in sorted order to avoid deadlock
  const keys = Array.from(store.keys()).sort();
  const locks = keys.map((k) => getKeyLock(k));
  const releases: Array<() => void> = [];

  try {
    for (const lock of locks) {
      releases.push(await lock.lock());
    }
    const obj: Record<string, any> = {};
    for (const [k, v] of store.entries()) {
      obj[k] = v.value;
    }
    return res.status(200).json({ store: obj });
  } finally {
    // Release all locks in reverse order
    for (let i = releases.length - 1; i >= 0; i--) {
      releases[i]();
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Starting ${ROLE} on port ${PORT}`);
  console.log("MIN_DELAY_MS", MIN_DELAY_MS);
  console.log("MAX_DELAY_MS", MAX_DELAY_MS);
});
