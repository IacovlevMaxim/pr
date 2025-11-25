import Mutex from './Mutex';    
import { AxiosInstance } from "axios";

let versionCounter = 0;
const versionLock = new Mutex();
const MIN_DELAY_MS = Number(process.env.MIN_DELAY || '0');
const MAX_DELAY_MS = Number(process.env.MAX_DELAY || '1000');
const REPL_TIMEOUT = Number(process.env.REPL_TIMEOUT || '2000');

export async function getNextVersion(): Promise<number> {
  const release = await versionLock.lock();
  try {
    versionCounter += 1;
    return versionCounter;
  } finally {
    release();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function replicateToFollower(
  client: AxiosInstance,
  followerAddr: string,
  key: string,
  value: any,
  version: number,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const delayMs = Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS;
    await sleep(delayMs);

    const url = `http://${followerAddr.replace(/^https?:\/\//, '')}/replicate`;
    const resp = await client.post(url, { key, value, version }, { timeout: REPL_TIMEOUT, signal });
    
    return resp.status === 200;
  } catch (e) {
    return false;
  }
}