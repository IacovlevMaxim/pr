#!/usr/bin/env python3
"""
Test script to compare single-threaded vs multithreaded server performance.
Makes 10 concurrent requests to the server and measures total time.
"""

import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse


def make_request(host, port, path="/"):
    """Make a single HTTP GET request."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(15)  # Increase timeout for slower responses
            s.connect((host, port))
            
            request = f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n"
            s.sendall(request.encode())
            
            # Read response
            response = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                response += chunk
                # Check if we've received the complete response
                if b"\r\n\r\n" in response:
                    # For chunked encoding, check for end marker
                    if b"0\r\n\r\n" in response:
                        break
            
            # Extract status code
            status_line = response.split(b"\r\n")[0].decode('utf-8')
            return status_line
    except Exception as e:
        return f"Error: {e}"


def test_concurrent_requests(host, port, num_requests=10, path="/"):
    """Test server with concurrent requests."""
    print(f"\n{'='*60}")
    print(f"Testing with {num_requests} concurrent requests to {path}")
    print(f"{'='*60}")
    
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=num_requests) as executor:
        # Submit all requests
        futures = [executor.submit(make_request, host, port, path) for _ in range(num_requests)]
        
        # Wait for all to complete
        results = []
        for i, future in enumerate(as_completed(futures), 1):
            result = future.result()
            results.append(result)
            print(f"Request {i} completed: {result}")
    
    end_time = time.time()
    total_time = end_time - start_time
    
    print(f"\n{'='*60}")
    print(f"RESULTS:")
    print(f"{'='*60}")
    print(f"Total time: {total_time:.2f} seconds")
    print(f"Average time per request: {total_time/num_requests:.2f} seconds")
    print(f"Requests per second: {num_requests/total_time:.2f}")
    print(f"{'='*60}\n")
    
    return total_time


def test_sequential_requests(host, port, num_requests=10, path="/"):
    """Test server with sequential requests (simulating single-threaded behavior)."""
    print(f"\n{'='*60}")
    print(f"Testing with {num_requests} sequential requests to {path}")
    print(f"{'='*60}")
    
    start_time = time.time()
    
    for i in range(num_requests):
        result = make_request(host, port, path)
        print(f"Request {i+1} completed: {result}")
    
    end_time = time.time()
    total_time = end_time - start_time
    
    print(f"\n{'='*60}")
    print(f"RESULTS:")
    print(f"{'='*60}")
    print(f"Total time: {total_time:.2f} seconds")
    print(f"Average time per request: {total_time/num_requests:.2f} seconds")
    print(f"Requests per second: {num_requests/total_time:.2f}")
    print(f"{'='*60}\n")
    
    return total_time


def main():
    parser = argparse.ArgumentParser(description="Test HTTP server concurrency")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=65432, help="Server port")
    parser.add_argument("--requests", type=int, default=15, help="Number of requests to make")
    parser.add_argument("--rate-limit", type=int, default=15, help="Rate limit (requests per second)")
    parser.add_argument("--path", default="/", help="Path to request")
    parser.add_argument("--mode", choices=["concurrent", "sequential", "both"], 
                       default="both", help="Test mode")
    
    args = parser.parse_args()
    
    print(f"\n{'#'*60}")
    print(f"# HTTP Server Concurrency Test")
    print(f"# Server: {args.host}:{args.port}")
    print(f"# Path: {args.path}")
    print(f"# Number of requests: {args.requests}")
    print(f"{'#'*60}")
    
    if args.mode in ["concurrent", "both"]:
        concurrent_time = test_concurrent_requests(args.host, args.port, args.requests, args.path)
    
    if args.mode in ["sequential", "both"]:
        sequential_time = test_sequential_requests(args.host, args.port, args.requests, args.path)
    
    if args.mode == "both":
        print(f"\n{'='*60}")
        print(f"COMPARISON:")
        print(f"{'='*60}")
        print(f"Sequential time: {sequential_time:.2f} seconds")
        print(f"Concurrent time: {concurrent_time:.2f} seconds")
        print(f"Speedup: {sequential_time/concurrent_time:.2f}x")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
