import requests
import time
import random
import statistics
import concurrent.futures
import matplotlib.pyplot as plt
import json
from requests.adapters import HTTPAdapter

LEADER = "http://localhost:5000"
FOLLOWERS = [
    "http://localhost:5001",
    "http://localhost:5002",
    "http://localhost:5003",
    "http://localhost:5004",
    "http://localhost:5005",
]

# Tunable parameters
TOTAL_WRITES = 1_000
CONCURRENCY = 20  # number of concurrent threads
KEY_SPACE = 1_000   # larger keyspace to reduce hot-key contention

# timeouts & warmup
REQUEST_TIMEOUT = 10.0
WARMUP_WRITES = min(10, CONCURRENCY)

# create a single session with pooled adapter for keep-alive / connection reuse
_session = requests.Session()
_adapter = HTTPAdapter(pool_connections=CONCURRENCY, pool_maxsize=max(CONCURRENCY * 2, 50))
_session.mount("http://", _adapter)
_session.mount("https://", _adapter)

def wait_for_services(timeout=30):
    print("Here I check if all services are ready to avoid connection refused")
    start = time.time()

    while time.time() - start < timeout:
        try:
            _session.get(f"{LEADER}/admin/get_quorum", timeout=2)
            print("All services ready!")
            return
        except Exception:
            time.sleep(0.5)

    raise Exception("Services did not start in time")


def set_quorum(q):
    r = _session.post(f"{LEADER}/admin/set_quorum", json={"quorum": q}, timeout=5)
    if r.status_code == 200:
        print(f"Set write quorum to {q}")
    else:
        print(f"Failed to set quorum: {r.text}")
    return r


def single_write(session, key, value):
    t0 = time.perf_counter()
    try:
        r = session.post(f"{LEADER}/put/{key}", json={"value": value}, timeout=REQUEST_TIMEOUT)
        t1 = time.perf_counter()
        latency = t1 - t0
        replicas = None
        try:
            j = r.json()
            if isinstance(j, dict):
                replicas = j.get("replicas_confirmed")
        except Exception:
            replicas = None
        return {"status": r.status_code, "text": r.text, "latency": latency, "error": None, "replicas": replicas}
    except Exception as e:
        t1 = time.perf_counter()
        return {"status": 500, "text": str(e), "latency": (t1 - t0), "error": type(e).__name__, "replicas": None}


def percentile(sorted_list, p):
    if not sorted_list:
        return 0.0
    k = (len(sorted_list) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_list) - 1)
    if f == c:
        return sorted_list[int(k)]
    d0 = sorted_list[f] * (c - k)
    d1 = sorted_list[c] * (k - f)
    return d0 + d1


def run_for_quorum(q):
    print(f"\n{'='*60}")
    print(f"Running workload for QUORUM = {q}")
    print(f"{'='*60}")

    set_quorum(q)
    time.sleep(0.5)  # Let quorum change propagate

    random.seed(42)
    keys = [f"key-{i % KEY_SPACE}" for i in range(TOTAL_WRITES)]
    random.shuffle(keys)

    # warmup to prime connections and caches
    print(f"Warmup: {WARMUP_WRITES} writes (not measured)...")
    for i in range(WARMUP_WRITES):
        k = f"warm-{i}"
        try:
            _session.post(f"{LEADER}/put/{k}", json={"value": f"warm-{i}"}, timeout=REQUEST_TIMEOUT)
        except Exception:
            pass
    time.sleep(0.2)

    records = []
    print(f"Starting {TOTAL_WRITES} writes with {CONCURRENCY} concurrent threads...")
    start_time = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = [executor.submit(single_write, _session, k, f"val-{i}-q{q}") for i, k in enumerate(keys)]
        for fut in concurrent.futures.as_completed(futures):
            try:
                rec = fut.result()
                records.append(rec)
            except Exception as e:
                records.append({"status": 500, "text": str(e), "latency": 0.0, "error": type(e).__name__, "replicas": None})

    end_time = time.perf_counter()
    total_time = end_time - start_time

    success_latencies = sorted([r["latency"] for r in records if r["status"] == 200 and not r["error"]])
    error_latencies = sorted([r["latency"] for r in records if r["status"] != 200 or r["error"]])
    success_count = sum(1 for r in records if r["status"] == 200)
    error_count = len(records) - success_count

    if success_latencies:
        avg = statistics.mean(success_latencies)
        p50 = percentile(success_latencies, 50)
        p95 = percentile(success_latencies, 95)
        p99 = percentile(success_latencies, 99)
        min_lat = min(success_latencies)
        max_lat = max(success_latencies)
    else:
        avg = p50 = p95 = p99 = min_lat = max_lat = 0.0

    throughput = TOTAL_WRITES / total_time if total_time > 0 else 0.0

    print(f"\n{'='*60}")
    print(f"Results for QUORUM = {q}:")
    print(f"  Total time:      {total_time:.2f}s")
    print(f"  Throughput:      {throughput:.2f} writes/sec")
    print(f"  Success:         {success_count}/{TOTAL_WRITES}")
    print(f"  Errors:          {error_count}/{TOTAL_WRITES}")
    print(f"  Avg latency (succ):     {avg*1000:.2f}ms")
    print(f"  P50 latency (succ):     {p50*1000:.2f}ms")
    print(f"  P95 latency (succ):     {p95*1000:.2f}ms")
    print(f"  P99 latency (succ):     {p99*1000:.2f}ms")
    print(f"  Min latency (succ):     {min_lat*1000:.2f}ms")
    print(f"  Max latency (succ):     {max_lat*1000:.2f}ms")
    print(f"{'='*60}\n")

    out = {
        "quorum": q,
        "total_time": total_time,
        "throughput": throughput,
        "success": success_count,
        "errors": error_count,
        "avg": avg,
        "p50": p50,
        "p95": p95,
        "p99": p99,
        "min": min_lat,
        "max": max_lat,
        "records": records,
    }
    # with open(f"perf_results_q{q}.json", "w") as fh:
    #     json.dump(out, fh, indent=2)

    return out

def plot_results(results):
    qs = [r["quorum"] for r in results]
    avgs = [r["avg"] * 1000 for r in results]  # Convert to ms
    p50s = [r["p50"] * 1000 for r in results]
    p95s = [r["p95"] * 1000 for r in results]
    p99s = [r["p99"] * 1000 for r in results]
    throughputs = [r["throughput"] for r in results]
    
    # Plot 1: Latency metrics
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    
    ax1.plot(qs, avgs, marker='o', label='Average', linewidth=2)
    ax1.plot(qs, p50s, marker='s', label='P50', linewidth=2)
    ax1.plot(qs, p95s, marker='^', label='P95', linewidth=2)
    ax1.plot(qs, p99s, marker='d', label='P99', linewidth=2)
    ax1.set_xlabel("Write Quorum (# follower confirmations)", fontsize=11)
    ax1.set_ylabel("Latency (ms)", fontsize=11)
    ax1.set_title(f"Write Quorum vs Latency ({TOTAL_WRITES} writes)", fontsize=12, fontweight='bold')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_xticks(qs)
    
    # Plot 2: Throughput
    ax2.plot(qs, throughputs, marker='o', color='green', linewidth=2)
    ax2.set_xlabel("Write Quorum (# follower confirmations)", fontsize=11)
    ax2.set_ylabel("Throughput (writes/sec)", fontsize=11)
    ax2.set_title("Write Quorum vs Throughput", fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.set_xticks(qs)
    
    plt.tight_layout()
    plt.show()
    # plt.savefig("performance_analysis.png", dpi=300)
    print("Plot saved to performance_analysis.png")

def consistency_check():
    print(f"\n{'='*60}")
    print("CONSISTENCY CHECK")
    print(f"{'='*60}")
    
    try:
        # Fetch leader store
        r = requests.get(f"{LEADER}/admin/store", timeout=10)
        leader_store = r.json().get("store", {})
        leader_keys = set(leader_store.keys())
        print(f"Leader has {len(leader_keys)} keys")
        
        # Check each follower
        all_consistent = True
        for i, follower in enumerate(FOLLOWERS, 1):
            try:
                r = requests.get(f"{follower}/admin/store", timeout=10)
                follower_store = r.json().get("store", {})
                follower_keys = set(follower_store.keys())
                
                # Find differences
                missing_keys = leader_keys - follower_keys
                extra_keys = follower_keys - leader_keys
                value_mismatches = []
                
                for key in leader_keys & follower_keys:
                    if leader_store[key] != follower_store[key]:
                        value_mismatches.append(key)
                
                print(f"\nFollower {i}:")
                print(f"  Total keys:        {len(follower_keys)}")
                print(f"  Missing keys:      {len(missing_keys)}")
                print(f"  Extra keys:        {len(extra_keys)}")
                print(f"  Value mismatches:  {len(value_mismatches)}")
                
                if missing_keys or extra_keys or value_mismatches:
                    all_consistent = False
                    if missing_keys:
                        print(f"  Sample missing: {list(missing_keys)[:5]}")
                    if value_mismatches:
                        print(f"  Sample mismatches: {value_mismatches[:5]}")
                else:
                    print(f"  CONSISTENT with leader")
                    
            except Exception as e:
                print(f"\nFollower {i}:  ERROR - {e}")
                all_consistent = False
        
        print(f"\n{'='*60}")
        if all_consistent:
            print(" ALL REPLICAS CONSISTENT WITH LEADER")
        else:
            print(" INCONSISTENCIES DETECTED")
            print("\nPossible reasons:")
            print("  - Some writes failed to reach quorum but succeeded on some followers")
            print("  - Network delays caused some replications to be incomplete")
            print("  - This is expected in semi-synchronous replication!")
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f" Consistency check failed: {e}")

def main():
    try:
        wait_for_services()
        
        results = []
        for q in range(1, 6):
            result = run_for_quorum(q)
            results.append(result)
            # Small break between runs
            time.sleep(1)
        
        plot_results(results)
        
        # Wait a bit for all async replications to complete
        print("\nWaiting 5 seconds for all replications to complete...")
        time.sleep(5)
        
        consistency_check()
        
        # Print analysis summary
        print(f"\n{'='*60}")
        print("ANALYSIS SUMMARY")
        print(f"{'='*60}")
        print("\nExpected behavior:")
        print("1. Latency should INCREASE with quorum size")
        print("   - Higher quorum = wait for more followers = higher latency")
        print("2. Throughput should DECREASE with quorum size")
        print("   - More confirmations needed = slower writes")
        print("3. Consistency may vary:")
        print("   - Lower quorum = faster but less consistent")
        print("   - Higher quorum = slower but more consistent")
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f"\n✗ Performance test failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

if __name__ == "__main__":
    main()