import argparse
import os
import signal
import socket
import sys
from pathlib import Path
from httphandler import HTTPHandler

DIR_CALLED = Path(os.getcwd())
HOST = "127.0.0.1"  # localhost
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


def serve(*, root_dir, host, port):
    # Find an available port
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

        handler = HTTPHandler(root_dir)

        while True:
            conn, addr = server_socket.accept()
            conn.settimeout(10)
            with conn:
                buffer = b""
                while b"\r\n\r\n" not in buffer:
                    chunk = conn.recv(1024)
                    if not chunk:  # Connection closed by client
                        print("Connection closed by client before headers received")
                        break
                    buffer += chunk

                if not buffer:
                    print("Received empty data. Awaiting new connection...")
                    continue

                handler.handle_request(buffer, conn)


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
    return parser.parse_args()


def signal_handler(signal, frame):
    print("\nExiting...")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    args = parse_args()
    serve(root_dir=Path(args.dir).resolve(), host=args.host, port=args.port)