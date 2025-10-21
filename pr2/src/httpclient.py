import socket
import argparse
import os

BUFFER_SIZE = 4096
SOCKET_TIMEOUT = 5

parser = argparse.ArgumentParser()
parser.add_argument("server", type=str, nargs='?')
parser.add_argument("port", type=int, nargs='?', default=80)
parser.add_argument("download_dir", type=str, nargs='?', default='.')
parser.add_argument("method", type=str, nargs='?')
parser.add_argument("filename", type=str, nargs='?')
args = parser.parse_args()

SERVER = args.server
PORT = args.port
METHOD = args.method
FILE = args.filename
DOWNLOAD_DIR = args.download_dir

try:
    clientsocket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    clientsocket.connect((SERVER, PORT))

    request = (f"{METHOD} /{FILE} HTTP/1.1\r\nHost: {SERVER}:{PORT}\r\n"
               f"User-Agent: simple_client\r\nAccept: */*\r\n\r\n")

    print(request)

    clientsocket.send(request.encode())
    clientsocket.settimeout(SOCKET_TIMEOUT)

    http_response = bytearray()

    try:
        while True:
            response = clientsocket.recv(BUFFER_SIZE)
            if not response:
                break
            http_response += response
    except socket.timeout:
        print("Socket timed out")

    clientsocket.close()

    try:
        header_end = http_response.find(b"\r\n\r\n")
        if header_end == -1:
            print("Invalid HTTP response")
            print(http_response.decode(errors='ignore'))
        else:
            headers = http_response[:header_end].decode()
            body = http_response[header_end + 4:]

            header_lines = headers.split("\r\n")
            content_type = None

            for line in header_lines[1:]:
                if line.lower().startswith("content-type:"):
                    content_type = line.split(":", 1)[1].strip().lower()
                    break

            if content_type and ("application/pdf" in content_type or "image/png" in content_type):
                if not os.path.exists(DOWNLOAD_DIR):
                    os.makedirs(DOWNLOAD_DIR)

                if FILE:
                    save_filename = os.path.basename(FILE)
                else:
                    ext = "pdf" if "pdf" in content_type else "png"
                    save_filename = f"downloaded_file.{ext}"

                save_path = os.path.join(DOWNLOAD_DIR, save_filename)

                with open(save_path, 'wb') as f:
                    f.write(body)

                print(f"File downloaded successfully to: {save_path}")
                print(f"Content-Type: {content_type}")
                print(f"File size: {len(body)} bytes")
            else:
                print(http_response.decode(errors='ignore'))

    except Exception as e:
        print(f"Error processing response: {e}")
        print(http_response.decode(errors='ignore'))

except KeyboardInterrupt:
    print("\nInterrupted by user")
    if 'clientsocket' in locals():
        clientsocket.close()
except Exception as e:
    print(f"Error: {e}")
    if 'clientsocket' in locals():
        clientsocket.close()