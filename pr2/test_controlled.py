#!/usr/bin/env python3
"""
Test script to send requests just below the rate limit.
Aims to stay at ~5 requests per second without being rate limited.
"""

import socket
import time
import argparse


def make_request(host, port, path="/", request_num=0):
    """Make a single HTTP GET request and return status."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect((host, port))
            
            request = f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n"
            s.sendall(request.encode())
            
            # Read just the status line
            response = b""
            while b"\r\n" not in response:
                chunk = s.recv(1024)
                if not chunk:
                    break
                response += chunk
            
            print("Received response:", response)
            status_line = response.split(b"\r\n")[0].decode('utf-8')
            status_code = status_line.split()[1] if len(status_line.split()) > 1 else "Unknown"
            
            return request_num, status_code, time.time()
    except Exception as e:
        return request_num, f"Error: {e}", time.time()


def controlled_test(host, port, duration=10, target_rate=4.5):
    """Send requests at a controlled rate below the limit."""
    print(f"\n{'='*60}")
    print(f"CONTROLLED TEST - Below rate limit")
    print(f"Duration: {duration} seconds")
    print(f"Target rate: {target_rate} requests/second")
    print(f"{'='*60}\n")
    
    start_time = time.time()
    end_time = start_time + duration
    
    successful_requests = 0
    rate_limited_requests = 0
    total_requests = 0
    
    request_num = 0
    delay = 1.0 / target_rate  # Delay between requests
    
    while time.time() < end_time:
        req_start = time.time()
        
        req_num, status, timestamp = make_request(host, port, "/", request_num)
        total_requests += 1
        
        if "200" in str(status):
            successful_requests += 1
            print(f"Request {req_num}: SUCCESS ({status})")
        elif "429" in str(status):
            rate_limited_requests += 1
            print(f"Request {req_num}: RATE LIMITED ({status})")
        else:
            print(f"Request {req_num}: {status}")
        
        # Sleep to maintain target rate
        elapsed = time.time() - req_start
        sleep_time = max(0, delay - elapsed)
        time.sleep(sleep_time)
        
        request_num += 1
    
    actual_duration = time.time() - start_time
    
    print(f"\n{'='*60}")
    print(f"CONTROLLED TEST RESULTS:")
    print(f"{'='*60}")
    print(f"Total requests: {total_requests}")
    print(f"Successful (200 OK): {successful_requests}")
    print(f"Rate limited (429): {rate_limited_requests}")
    print(f"Duration: {actual_duration:.2f} seconds")
    print(f"Actual throughput: {successful_requests/actual_duration:.2f} requests/second")
    print(f"Target throughput: {target_rate:.2f} requests/second")
    print(f"Success rate: {successful_requests/total_requests*100:.1f}%")
    print(f"{'='*60}\n")
    
    return successful_requests, rate_limited_requests, actual_duration


def main():
    parser = argparse.ArgumentParser(description="Controlled test for rate limiting")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=65432, help="Server port")
    parser.add_argument("--duration", type=int, default=10, 
                       help="Test duration in seconds")
    parser.add_argument("--rate", type=float, default=4.5,
                       help="Target request rate (requests/second)")
    
    args = parser.parse_args()
    
    print(f"\n{'#'*60}")
    print(f"# Rate Limiting Controlled Test")
    print(f"# Server: {args.host}:{args.port}")
    print(f"{'#'*60}")
    
    controlled_test(args.host, args.port, args.duration, args.rate)


if __name__ == "__main__":
    main()
