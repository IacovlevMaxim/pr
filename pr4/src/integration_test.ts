import axios from 'axios';

const LEADER = 'http://localhost:5000';
const FOLLOWERS = [
  'http://localhost:5001',
  'http://localhost:5002',
  'http://localhost:5003',
  'http://localhost:5004',
  'http://localhost:5005',
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServices(timeout = 30) {
  console.log('Here I check if all services are ready to avoid connection refused');
  const start = Date.now();
  let allReady = false;
  while ((Date.now() - start) / 1000 < timeout && !allReady) {
    try {
      await axios.get(`${LEADER}/admin/get_quorum`, { timeout: 2000 });
      for (const f of FOLLOWERS) {
        await axios.get(`${f}/admin/store`, { timeout: 2000 });
      }
      allReady = true;
      console.log('All services ready!');
    } catch (e) {
      console.error(e);
      await sleep(500);
    }
  }
  if (!allReady) throw new Error('Services did not start in time');
}

async function testBasicWriteAndRead() {
  console.log('\n=== Test 1: Basic Write and Read ===');
  const key = 'test-key-1';
  const value = 'test-value-1';
  console.log(`Writing key=${key}, value=${value} to leader...`);
  const r = await axios.post(`${LEADER}/put/${key}`, { value }, { timeout: 5000 });
  console.log(`Leader response: ${r.status} - ${JSON.stringify(r.data)}`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  if (r.data.status !== 'ok') throw new Error('Write should succeed');
  await sleep(1000);
  const r2 = await axios.get(`${LEADER}/get/${key}`, { timeout: 3000 });
  if (r2.status !== 200 || r2.data.value !== value) throw new Error('Leader has incorrect value');
  console.log('Leader has correct value');
  for (let i = 0; i < FOLLOWERS.length; i++) {
    const follower = FOLLOWERS[i];
    try {
      const rf = await axios.get(`${follower}/get/${key}`, { timeout: 3000 });
      if (rf.status === 200) {
        if (rf.data.value !== value) throw new Error(`Follower ${i + 1} has wrong value`);
        console.log(`Follower ${i + 1} has correct value`);
      } else {
        console.log(`Follower ${i + 1} missing key (status: ${rf.status})`);
      }
    } catch (e: any) {
      console.log(`Follower ${i + 1} error: ${e.message}`);
    }
  }
}

async function testQuorumBehavior() {
  console.log('\n=== Test 2: Quorum Behavior ===');
  const r = await axios.post(`${LEADER}/admin/set_quorum`, { quorum: 3 }, { timeout: 5000 });
  if (r.status !== 200) throw new Error('Failed to set quorum');
  console.log('Set write quorum to 3');
  for (let i = 0; i < 5; i++) {
    const key = `quorum-test-${i}`;
    const value = `value-${i}`;
    const resp = await axios.post(`${LEADER}/put/${key}`, { value }, { timeout: 5000 });
    if (resp.status === 200) {
      const replicas = resp.data.replicas_confirmed ?? 0;
      console.log(`Write ${i + 1}: confirmed on ${replicas} replicas (quorum=3)`);
      if (replicas < 3) throw new Error(`Expected at least 3 confirmations, got ${replicas}`);
    } else {
      console.log(`Write ${i + 1} failed: ${JSON.stringify(resp.data)}`);
    }
  }
}

async function testConcurrentWrites() {
  console.log('\n=== Test 3: Concurrent Writes ===');
  const tasks: Promise<boolean>[] = [];
  const total = 50;
  for (let i = 0; i < total; i++) {
    tasks.push(
      (async (idx: number) => {
        const key = `concurrent-${idx}`;
        const value = `value-${idx}`;
        try {
          const r = await axios.post(`${LEADER}/put/${key}`, { value }, { timeout: 10000 });
          return r.status === 200;
        } catch {
          return false;
        }
      })(i)
    );
  }
  const results = await Promise.all(tasks);
  const successCount = results.filter(Boolean).length;
  console.log(`${successCount}/${total} concurrent writes succeeded`);
  if (successCount < 45) throw new Error('Most writes should succeed');
}

async function testMissingKey() {
  console.log('\n=== Test 4: Missing Key Behavior ===');
  try {
    await axios.get(`${LEADER}/get/nonexistent-key`, { timeout: 3000 });
    throw new Error('Expected 404 for missing key');
  } catch (e: any) {
    if (e.response && e.response.status === 404 && e.response.data.found === false) {
      console.log('Correctly returns 404 for missing key');
    } else {
      throw e;
    }
  }
}

async function main() {
  try {
    await waitForServices();
    await testBasicWriteAndRead();
    await testQuorumBehavior();
    await testConcurrentWrites();
    await testMissingKey();
    console.log('\n' + '='.repeat(50));
    console.log('ALL TESTS PASSED!');
    console.log('='.repeat(50));
    process.exit(0);
  } catch (e: any) {
    console.error('\nTEST FAILED:', e.message || e);
    console.error(e.stack || '');
    process.exit(1);
  }
}

if (require.main === module) main();
