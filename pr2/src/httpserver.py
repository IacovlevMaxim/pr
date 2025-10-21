import argparse
import os
import signal
import socket
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from httphandler import HTTPHandler

DIR_CALLED = Path(os.getcwd())
HOST = "127.0.0.1"  
PORT = 65432
MAX_PORT_ATTEMPTS = 100


def find_available_port(host, start_port, max_attempts=MAX_PORT_ATTEMPTS):
    """Try to find an available port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        try:
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            test_socket.bind((host, port))
            test_socket.close()
            return port
        except OSError:
            continue
    return None


def handle_client(conn, addr, handler):
    """Handle a single client connection in a separate thread."""
    try:
        conn.settimeout(10)
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = conn.recv(1024)
            if not chunk: 
                print("Connection closed by client before headers received")
                return
            buffer += chunk

        if buffer:
            handler.handle_request(buffer, conn, addr)
    except Exception as e:
        print(f"Error handling request from {addr}: {e}")
    finally:
        conn.close()


def serve(*, root_dir, host, port, max_workers=10, simulate_work=False, use_locks=False, rate_limit=5):
    available_port = find_available_port(host, port)

    if available_port is None:
        print(f"Error: Could not find an available port in range {port}-{port + MAX_PORT_ATTEMPTS - 1}")
        sys.exit(1)

    if available_port != port:
        print(f"Port {port} is already in use. Using port {available_port} instead.")

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    with server_socket:
        server_socket.bind((host, available_port))
        server_socket.listen()
        print(f"Serving HTTP on {host} port {available_port} (http://{host}:{available_port}/) ...")
        print(f"Using thread pool with {max_workers} workers")
        print(f"Simulate work: {simulate_work}, Use locks: {use_locks}")
        print(f"Rate limit: {rate_limit} requests/second per IP")

        handler = HTTPHandler(root_dir, simulate_work=simulate_work, use_locks=use_locks, rate_limit=rate_limit)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            while True:
                conn, addr = server_socket.accept()
                executor.submit(handle_client, conn, addr, handler)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--host",
        type=str,
        default=HOST,
        help="specify alternate host [default: localhost (127.0.0.1)]",
    )
    parser.add_argument(
        "--port", type=int, default=PORT, help="specify alternate port [default: 65432]"
    )
    parser.add_argument(
        "--dir",
        type=str,
        default=DIR_CALLED,
        help="specify root directory [default: the directory you're at right now]",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=10,
        help="number of worker threads [default: 10]",
    )
    parser.add_argument(
        "--simulate-work",
        action="store_true",
        help="add 1s delay to simulate work (for testing)",
    )
    parser.add_argument(
        "--use-locks",
        action="store_true",
        help="use locks for thread-safe counters",
    )
    parser.add_argument(
        "--rate-limit",
        type=int,
        default=5,
        help="maximum requests per second per IP [default: 5]",
    )
    return parser.parse_args()


def signal_handler(signal, frame):
    print("\nExiting...")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    args = parse_args()
    serve(
        root_dir=Path(args.dir).resolve(),
        host=args.host,
        port=args.port,
        max_workers=args.workers,
        simulate_work=args.simulate_work,
        use_locks=args.use_locks,
        rate_limit=args.rate_limit,
    )