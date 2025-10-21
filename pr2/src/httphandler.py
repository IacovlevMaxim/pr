import datetime
import os
import platform
import re
import time
import threading
from collections import defaultdict
from enum import Enum
from html import escape as html_escape
from mimetypes import guess_type
from pathlib import Path
from typing import Union
from urllib.parse import unquote, quote


class StatusCode(Enum):
    OK = "200 OK"
    BAD_REQUEST = "400 Bad Request"
    FORBIDDEN = "403 Forbidden"
    NOT_FOUND = "404 Not Found"
    MET_NOT_AL = "405 Method Not Allowed"
    TOO_MANY_REQUESTS = "429 Too Many Requests"


class HTTPHandler:
    def __init__(self, root_dir: Path, simulate_work=False, use_locks=False, rate_limit=5) -> None:
        self.root_dir = root_dir
        self.simulate_work = simulate_work
        self.use_locks = use_locks
        
        # Request counter (naive implementation - prone to race conditions)
        self.request_counter = defaultdict(int)
        self.counter_lock = threading.Lock() if use_locks else None
        
        # Rate limiting (thread-safe implementation)
        self.rate_limit_requests = rate_limit  # requests per second per IP (configurable)
        self.rate_limit_window = 1.0  # 1 second window
        self.request_timestamps = defaultdict(list)  # IP -> [timestamps]
        self.rate_limit_lock = threading.Lock()

    def handle_request(self, raw_request: bytes, conn, addr):
        """Handle an HTTP request

        Args:
            raw_request (bytes): The raw request
            conn: The Server-Client TCP connection
            addr: The client address (IP, port)
        """
        client_ip = addr[0]
        
        # Check rate limit
        if not self._check_rate_limit(client_ip):
            self.send_response(conn, StatusCode.TOO_MANY_REQUESTS)
            return
        
        # Simulate work (for testing purposes)
        if self.simulate_work:
            time.sleep(1.0)
        
        try:
            request_first_line = raw_request.split(b"\r\n")[0].decode("iso-8859-1")
            method, req_path, version = request_first_line.split()
            req_path = self.handle_path(Path(req_path))
            if req_path.exists() and not os.access(str(req_path), os.R_OK):
                self.send_response(conn, StatusCode.FORBIDDEN)
                return
        except ValueError:  # problem to unpack the 3 values
            self.send_response(conn, StatusCode.BAD_REQUEST)
            return

        if method == "GET":
            print(f"requested path: {req_path}")
            if not req_path.exists():
                self.send_response(conn, StatusCode.NOT_FOUND)
            else:
                # Increment counter for this file/directory
                self._increment_counter(req_path)
                self.send_response(conn, StatusCode.OK, req_path)
        else:
            self.send_response(conn, StatusCode.MET_NOT_AL)
    
    def _check_rate_limit(self, client_ip):
        """Check if the client IP is within rate limit."""
        current_time = time.time()
        
        with self.rate_limit_lock:
            # Get timestamps for this IP
            timestamps = self.request_timestamps[client_ip]
            
            # Remove timestamps older than the window
            timestamps[:] = [ts for ts in timestamps if current_time - ts < self.rate_limit_window]
            
            # Check if within limit
            if len(timestamps) >= self.rate_limit_requests:
                return False
            
            # Add current request timestamp
            timestamps.append(current_time)
            return True
    
    def _increment_counter(self, req_path):
        """Increment the request counter for a path."""
        if self.use_locks:
            # Thread-safe version
            with self.counter_lock:
                old_value = self.request_counter[str(req_path)]
                # Add artificial delay to demonstrate race condition potential
                time.sleep(0.001)  # 1ms delay
                self.request_counter[str(req_path)] = old_value + 1
        else:
            # Naive version - prone to race conditions
            old_value = self.request_counter[str(req_path)]
            # Add artificial delay to force race conditions
            time.sleep(0.001)  # 1ms delay to increase likelihood of interleaving
            self.request_counter[str(req_path)] = old_value + 1

    def handle_path(self, req_path: Path):
        """Retrieve a handled version of the requested path

        Args:
            req_path (Path): The requested path

        Returns:
            Path: The handled requested path
        """

        # The requested path must:
        # - Avoid higher directories traversal when something like "../" is used
        # - Have no leading slash to join paths correctly.
        # - Be unquoted.
        #     The url path (that should be quoted) must be unquoted to use in OS
        #     operations. Example: the requested path "t%C3%A9st" is the quoted
        #     version of "tést", but to perform OS operations with this path we
        #     need it in its original form "tést", thus it is unquoted.
        req_str = str(req_path)
        req_str = re.sub("(/\\.{2,})+/?", "/", req_str)
        req_str = unquote(req_str.lstrip("/"))

        return (self.root_dir / Path(req_str)).resolve()

    def response_header(
        self,
        status_code: StatusCode,
        content_type: Union[str, None],
        content_length: Union[int, None],
        charset: Union[str, None] = None,
    ):
        header = f"HTTP/1.1 {status_code.value}\r\n"
        header += f"Server: MySimpleHTTPServer Python/{platform.python_version()}\r\n"
        header += (
            f"Date: {datetime.datetime.now().strftime('%a, %d %b %Y %H:%M:%S GMT')}\r\n"
        )
        if charset:
            header += f"Content-Type: {content_type}; charset={charset}\r\n"
        else:
            header += f"Content-Type: {content_type}\r\n"
        if content_length:
            header += f"Content-Length: {str(content_length)}\r\n"
        else:
            header += "Transfer-Encoding: chunked\r\n"
        header += "\r\n"
        return header.encode("utf-8")

    def send_response(
        self, conn, status_code: StatusCode, req_path: Union[Path, None] = None
    ):
        if status_code == StatusCode.OK and req_path:
            if req_path.is_dir():
                body = self.list_dir_body(req_path)
                header = self.response_header(
                    status_code=status_code,
                    content_type="text/html",
                    content_length=len(body),
                    charset="utf-8",
                )
                conn.sendall(header + body)

            elif req_path.is_file():
                content_type, _ = guess_type(req_path)
                charset = "utf-8" if (content_type and "text" in content_type) else None
                header = self.response_header(
                    status_code=status_code,
                    content_type=content_type,
                    content_length=None,
                    charset=charset,
                )
                conn.sendall(header)
                self.send_file(conn, req_path)

        else:
            body = self.error_body(status_code)
            header = self.response_header(
                status_code=status_code,
                content_type="text/html",
                content_length=len(body),
                charset="utf-8",
            )
            print(f"An ERROR occured. Status Code: {status_code.value}")
            conn.sendall(header + body)

    def list_dir_body(self, directory: Path):
        """Generates HTML for a directory listing

        Args:
            directory (str): Directory to list
        """
        entries = ""  # the filepaths of a directory list

        for entry in sorted(list(directory.iterdir())):
            # Replace special characters "&", "<" and ">" to HTML-safe
            # sequences for rendering
            escaped_entry = Path(html_escape(str(entry)))

            # The unquoted OS paths (for example "tést") must be quoted
            # to be a valid URL ("t%C3%A9st")
            quoted_entry = Path(quote(str(entry)))

            # Final slash for directories only
            final_slash = "/" if escaped_entry.is_dir() else ""
            
            # Get request count for this entry
            if self.use_locks:
                with self.counter_lock:
                    count = self.request_counter.get(str(entry), 0)
            else:
                count = self.request_counter.get(str(entry), 0)

            entries += f'<li><a href="{quoted_entry.name}{final_slash}">{escaped_entry.name}{final_slash}</a> ({count} hits)</li>'

        escaped_directory = Path(html_escape(str(directory)))
        escaped_directory = (
            str(directory).split(str(self.root_dir))[-1]
            if directory != self.root_dir
            else "/"
        )

        html = f"""
            <html>
                <head>
                    <title>HTTP Server
                    </title>
                </head>
                <body>
                    <h1>Directory listing for {escaped_directory}</h1>
                    <hr>
                    <ul>{entries}</ul>
                    <hr>
                </body>
            </html>
            """
        return html.encode("utf-8")

    def error_body(self, status_code: StatusCode):
        """Generates HTML body for errors"""
        html = f"""
            <html>
                <head>
                    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
                    <title>{status_code.value}</title>
                </head>
                <body>
                    <h1>{status_code.value}</h1>
                </body>
            </html>
            """
        return html.encode("utf-8")

    def send_file(self, conn, filepath: Path):
        for chunk in self.chunk_encoded_file_content(filepath):
            conn.sendall(chunk)

    def chunk_encoded_file_content(self, filepath: Path):
        """Yield file chunk in Transfer-Encoding pattern

        https://en.wikipedia.org/wiki/Chunked_transfer_encoding
        https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding
        """
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(1024)
                if not chunk:
                    break
                hex_len_chunk = hex(len(chunk)).split("0x")[-1].upper()
                yield f"{hex_len_chunk}".encode("ascii") + b"\r\n" + chunk + b"\r\n"
            yield b"0\r\n\r\n"
