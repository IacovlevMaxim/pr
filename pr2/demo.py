#!/usr/bin/env python3
"""
Comprehensive demo script showing all features of the multithreaded HTTP server.
This script automates the testing process described in the lab requirements.
"""

import subprocess
import time
import sys
import signal
import os

def print_section(title):
    """Print a formatted section header."""
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}\n")

def print_step(step_num, description):
    """Print a formatted step."""
    print(f"\n[STEP {step_num}] {description}")
    print("-" * 70)

def wait_for_keypress(message="Press Enter to continue..."):
    """Wait for user to press Enter."""
    input(f"\n{message}")

def run_server(script, port, args=""):
    """Start a server in the background."""
    cmd = f"cd src && python {script} --port {port} {args}"
    print(f"Starting server: {cmd}")
    process = subprocess.Popen(
        cmd,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=os.setsid
    )
    time.sleep(2)  # Give server time to start
    return process

def stop_server(process):
    """Stop a server process."""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        process.wait(timeout=3)
    except:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except:
            pass

def run_test(test_script, args=""):
    """Run a test script and display output."""
    cmd = f"python {test_script} {args}"
    print(f"Running: {cmd}\n")
    result = subprocess.run(cmd, shell=True, capture_output=False)
    return result.returncode == 0


def main():
    print_section("MULTITHREADED HTTP SERVER - COMPREHENSIVE DEMO")
    print("This script will demonstrate all features of the enhanced HTTP server:")
    print("1. Multithreading with thread pool")
    print("2. Performance comparison (single vs multi-threaded)")
    print("3. Request counter with race condition demo")
    print("4. Thread-safe counter with locks")
    print("5. Rate limiting by client IP")
    
    wait_for_keypress("Press Enter to start the demo...")
    
    # ==================================================================
    # PART 1: Single-threaded vs Multithreaded Performance
    # ==================================================================
    
    print_section("PART 1: Performance Comparison")
    print("Comparing single-threaded vs multithreaded server performance")
    print("with 10 concurrent requests and 1-second simulated work delay.")
    
    # Test 1: Single-threaded server
    print_step(1, "Testing SINGLE-THREADED server")
    print("Starting single-threaded server on port 65433...")
    server_single = run_server("httpserver_single.py", 65433, "--simulate-work")
    
    wait_for_keypress("Server started. Press Enter to run the test...")
    run_test("test_concurrent.py", "--port 65433 --requests 10")
    
    print("\nStopping single-threaded server...")
    stop_server(server_single)
    
    wait_for_keypress("\nPress Enter to test the multithreaded server...")
    
    # Test 2: Multithreaded server
    print_step(2, "Testing MULTITHREADED server")
    print("Starting multithreaded server on port 65433...")
    server_multi = run_server("httpserver.py", 65433, "--simulate-work --use-locks")
    
    wait_for_keypress("Server started. Press Enter to run the test...")
    run_test("test_concurrent.py", "--port 65433 --requests 10")
    
    print("\nStopping multithreaded server...")
    stop_server(server_multi)
    
    print_section("PART 1 SUMMARY")
    print("✅ Single-threaded: ~10 seconds (requests handled sequentially)")
    print("✅ Multithreaded: ~1-2 seconds (requests handled in parallel)")
    print("✅ Speedup: ~5-10x faster with multithreading!")
    
    wait_for_keypress("\nPress Enter to continue to Part 2...")
    
    # ==================================================================
    # PART 2: Race Condition Demo
    # ==================================================================
    
    print_section("PART 2: Request Counter - Race Condition Demo")
    print("Demonstrating race conditions in naive counter implementation")
    
    # Test 3: Without locks (race condition)
    print_step(3, "Testing counter WITHOUT locks (naive implementation)")
    print("Starting server WITHOUT thread safety...")
    server_no_locks = run_server("httpserver.py", 65432, "")
    
    wait_for_keypress("Server started. Press Enter to make 50 concurrent requests...")
    run_test("test_concurrent.py", "--port 65432 --requests 50 --path /httpclient.py")
    
    print("\n" + "!"*70)
    print("⚠️  CHECK THE DIRECTORY LISTING")
    print("!"*70)
    print("Open http://127.0.0.1:65432/ in your browser")
    print("The hit counter will likely show LESS than 50 due to race conditions!")
    print("Multiple threads updating the counter simultaneously causes lost updates.")
    
    wait_for_keypress("\nPress Enter after checking the browser...")
    
    print("\nStopping server...")
    stop_server(server_no_locks)
    
    wait_for_keypress("\nPress Enter to test with locks...")
    
    # Test 4: With locks (fixed)
    print_step(4, "Testing counter WITH locks (thread-safe implementation)")
    print("Starting server WITH thread safety...")
    server_with_locks = run_server("httpserver.py", 65432, "--use-locks --rate-limit 100")
    
    wait_for_keypress("Server started. Press Enter to make 50 concurrent requests...")
    run_test("test_concurrent.py", "--port 65432 --requests 50 --path /httpclient.py")
    
    print("\n" + "!"*70)
    print("✅ CHECK THE DIRECTORY LISTING")
    print("!"*70)
    print("Open http://127.0.0.1:65432/ in your browser")
    print("The hit counter should show EXACTLY 50 (or 100 if you didn't restart)!")
    print("Locks ensure thread-safe updates with no lost increments.")
    
    wait_for_keypress("\nPress Enter after checking the browser...")
    
    print("\nStopping server...")
    stop_server(server_with_locks)
    
    print_section("PART 2 SUMMARY")
    print("✅ Without locks: Race conditions cause lost updates")
    print("✅ With locks: All updates recorded correctly")
    print("✅ Thread synchronization prevents race conditions")
    
    wait_for_keypress("\nPress Enter to continue to Part 3...")
    
    # ==================================================================
    # PART 3: Rate Limiting
    # ==================================================================
    
    print_section("PART 3: Rate Limiting by Client IP")
    print("Testing rate limiting (~5 requests/second per IP)")
    
    print_step(5, "Starting server with rate limiting")
    server_rate = run_server("httpserver.py", 65432, "--use-locks")
    
    wait_for_keypress("Server started. Press Enter to run spam test...")
    
    # Test 5: Spam test
    print_step(6, "SPAM TEST - Exceeding rate limit")
    print("Sending as many requests as possible for 10 seconds...")
    run_test("test_spam.py", "--port 65432 --duration 10")
    
    print("\n" + "!"*70)
    print("📊 ANALYSIS")
    print("!"*70)
    print("Notice that most requests were rate limited (429 status)")
    print("Successful throughput should be ~5 requests/second")
    
    wait_for_keypress("\nPress Enter to run controlled test...")
    
    # Test 6: Controlled test
    print_step(7, "CONTROLLED TEST - Below rate limit")
    print("Sending requests at 4.5 requests/second for 10 seconds...")
    run_test("test_controlled.py", "--port 65432 --duration 10 --rate 4.5")
    
    print("\n" + "!"*70)
    print("📊 ANALYSIS")
    print("!"*70)
    print("Notice that almost all requests succeeded (200 status)")
    print("Success rate should be close to 100%")
    
    wait_for_keypress("\nPress Enter to stop the server...")
    
    print("\nStopping server...")
    stop_server(server_rate)
    
    print_section("PART 3 SUMMARY")
    print("✅ Spam test: ~5 successful requests/second, many 429 errors")
    print("✅ Controlled test: High success rate, few/no 429 errors")
    print("✅ Rate limiter ensures fair access for all clients")
    
    # ==================================================================
    # FINAL SUMMARY
    # ==================================================================
    
    print_section("DEMO COMPLETE!")
    print("All features have been demonstrated:")
    print("")
    print("✅ 1. Multithreading with ThreadPoolExecutor")
    print("✅ 2. 5-10x performance improvement over single-threaded")
    print("✅ 3. Request counter feature in directory listings")
    print("✅ 4. Race condition demonstration (without locks)")
    print("✅ 5. Thread-safe implementation (with locks)")
    print("✅ 6. Rate limiting by client IP (~5 req/s)")
    print("✅ 7. Thread-safe rate limiting implementation")
    print("")
    print("Lab requirements completed! 🎉")
    print("")
    print("For manual testing, run:")
    print("  cd src && python httpserver.py --simulate-work --use-locks")
    print("")
    print("Then visit: http://127.0.0.1:65432/")
    
    print("\n" + "="*70 + "\n")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nDemo interrupted by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n\nError: {e}")
        sys.exit(1)
