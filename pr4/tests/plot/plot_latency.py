import requests
import time
import random
import statistics
import concurrent.futures
import matplotlib.pyplot as plt
import json
import sys
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

    return {
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


def plot_latencies(result):
    """Plot latencies as a time series and histogram."""
    quorum = result["quorum"]
    records = result["records"]
    
    # Extract successful latencies in milliseconds
    success_recs = [r for r in records if r["status"] == 200 and not r["error"]]
    latencies_ms = sorted([r["latency"] * 1000 for r in success_recs])
    
    if not latencies_ms:
        print("No successful records to plot")
        return
    
    # Create figure with 3 subplots
    fig, axes = plt.subplots(2, 2, figsize=(16, 10))
    
    # Plot 1: Latency as scatter (per-request)
    ax1 = axes[0, 0]
    ax1.scatter(range(len(latencies_ms)), latencies_ms, alpha=0.5, s=10)
    ax1.axhline(result["p50"] * 1000, color='orange', linestyle='--', label=f'P50: {result["p50"]*1000:.2f}ms')
    ax1.axhline(result["p95"] * 1000, color='red', linestyle='--', label=f'P95: {result["p95"]*1000:.2f}ms')
    ax1.axhline(result["p99"] * 1000, color='darkred', linestyle='--', label=f'P99: {result["p99"]*1000:.2f}ms')
    ax1.axhline(result["avg"] * 1000, color='green', linestyle='-', linewidth=2, label=f'Avg: {result["avg"]*1000:.2f}ms')
    ax1.set_xlabel("Request Index", fontsize=11)
    ax1.set_ylabel("Latency (ms)", fontsize=11)
    ax1.set_title(f"Per-Request Latencies (QUORUM={quorum})", fontsize=12, fontweight='bold')
    ax1.legend(loc='upper left')
    ax1.grid(True, alpha=0.3)
    
    # Plot 2: Histogram of latencies
    ax2 = axes[0, 1]
    ax2.hist(latencies_ms, bins=50, alpha=0.7, color='blue', edgecolor='black')
    ax2.axvline(result["p50"] * 1000, color='orange', linestyle='--', linewidth=2, label=f'P50: {result["p50"]*1000:.2f}ms')
    ax2.axvline(result["p95"] * 1000, color='red', linestyle='--', linewidth=2, label=f'P95: {result["p95"]*1000:.2f}ms')
    ax2.axvline(result["p99"] * 1000, color='darkred', linestyle='--', linewidth=2, label=f'P99: {result["p99"]*1000:.2f}ms')
    ax2.set_xlabel("Latency (ms)", fontsize=11)
    ax2.set_ylabel("Frequency", fontsize=11)
    ax2.set_title(f"Latency Distribution (QUORUM={quorum})", fontsize=12, fontweight='bold')
    ax2.legend()
    ax2.grid(True, alpha=0.3, axis='y')
    
    # Plot 3: Cumulative distribution
    ax3 = axes[1, 0]
    sorted_lats = sorted(latencies_ms)
    cumulative = [(i + 1) / len(sorted_lats) * 100 for i in range(len(sorted_lats))]
    ax3.plot(sorted_lats, cumulative, linewidth=2, color='purple')
    ax3.axvline(result["p50"] * 1000, color='orange', linestyle='--', linewidth=2, label=f'P50: {result["p50"]*1000:.2f}ms')
    ax3.axvline(result["p95"] * 1000, color='red', linestyle='--', linewidth=2, label=f'P95: {result["p95"]*1000:.2f}ms')
    ax3.axvline(result["p99"] * 1000, color='darkred', linestyle='--', linewidth=2, label=f'P99: {result["p99"]*1000:.2f}ms')
    ax3.set_xlabel("Latency (ms)", fontsize=11)
    ax3.set_ylabel("CDF (%)", fontsize=11)
    ax3.set_title(f"Cumulative Distribution (QUORUM={quorum})", fontsize=12, fontweight='bold')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Summary statistics box
    ax4 = axes[1, 1]
    ax4.axis('off')
    summary_text = f"""
    QUORUM: {quorum}
    Total Writes: {len(success_recs)}
    Errors: {result["errors"]}
    
    Latency Statistics (ms):
    ─────────────────────────
    Min:     {result["min"]*1000:8.2f}
    P50:     {result["p50"]*1000:8.2f}
    P95:     {result["p95"]*1000:8.2f}
    P99:     {result["p99"]*1000:8.2f}
    Max:     {result["max"]*1000:8.2f}
    Avg:     {result["avg"]*1000:8.2f}
    
    Performance:
    ─────────────────────────
    Throughput: {result["throughput"]:.2f} writes/sec
    Total Time: {result["total_time"]:.2f}s
    """
    ax4.text(0.1, 0.9, summary_text, transform=ax4.transAxes, fontsize=11,
             verticalalignment='top', fontfamily='monospace',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.tight_layout()
    filename = f"latency_quorum_{quorum}.png"
    plt.savefig(filename, dpi=300)
    print(f"\nPlot saved to {filename}")
    plt.show()


def main():
    # Get quorum from command line or use default
    quorum = 1
    if len(sys.argv) > 1:
        try:
            quorum = int(sys.argv[1])
        except ValueError:
            print(f"Invalid quorum: {sys.argv[1]}. Using default quorum=1")
    
    try:
        wait_for_services()
        result = run_for_quorum(quorum)
        plot_latencies(result)
        
    except Exception as e:
        print(f"\n✗ Plot latency test failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


if __name__ == "__main__":
    main()
