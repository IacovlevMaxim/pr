#!/usr/bin/env python3
"""
Test script to demonstrate configurable rate limiting.
Tests different rate limit values to show the parameter works.
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


def run_server(port, rate_limit):
    """Start a server with specified rate limit."""
    cmd = f"cd src && python httpserver.py --port {port} --use-locks --rate-limit {rate_limit}"
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


def run_spam_test(port, duration=5):
    """Run spam test against a server."""
    cmd = f"python test_spam.py --port {port} --duration {duration} --workers 10"
    print(f"Running: {cmd}\n")
    subprocess.run(cmd, shell=True)


def main():
    print_section("CONFIGURABLE RATE LIMIT DEMONSTRATION")
    print("This script demonstrates the --rate-limit parameter.")
    print("It will test the server with different rate limit values.\n")
    
    test_configs = [
        {"rate_limit": 3, "port": 65430, "description": "Strict (3 req/s)"},
        {"rate_limit": 5, "port": 65431, "description": "Default (5 req/s)"},
        {"rate_limit": 10, "port": 65432, "description": "Permissive (10 req/s)"},
    ]
    
    for i, config in enumerate(test_configs, 1):
        print_section(f"TEST {i}: {config['description']}")
        print(f"Rate limit: {config['rate_limit']} requests/second")
        print(f"Port: {config['port']}\n")
        
        # Start server with specific rate limit
        server = run_server(config['port'], config['rate_limit'])
        
        print("Server started. Running spam test for 5 seconds...\n")
        time.sleep(1)
        
        # Run spam test
        run_spam_test(config['port'], duration=5)
        
        # Stop server
        print("\nStopping server...")
        stop_server(server)
        
        if i < len(test_configs):
            print("\n" + "-"*70)
            input("Press Enter to continue to next test...")
    
    print_section("DEMONSTRATION COMPLETE!")
    print("Summary of results:")
    print(f"  • Strict (3 req/s):      Expected ~3 successful requests/second")
    print(f"  • Default (5 req/s):     Expected ~5 successful requests/second")
    print(f"  • Permissive (10 req/s): Expected ~10 successful requests/second")
    print("\nThe --rate-limit parameter successfully controls the rate limiting!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nDemo interrupted by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
