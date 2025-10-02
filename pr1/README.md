# Lab 1: HTTP file server with TCP sockets

## Task
To develop an HTTP web server that serves HTML files from a directory. 
It will handle one HTTP request at a time. The server program should take the directory  to be served as a command-line argument.
Your web server should accept and parse the HTTP request, read the requested HTML file from the directory, create an HTTP response message consisting of the requested file preceded by header lines, and then send the response directly to the client. If the requested file is not present in the server (or is not an HTML file), the server should send an HTTP “404 Not Found” message back to the client.


## Implementation

### Choice of Language
For this project, I chose Python as the primary programming language. Python offers several advantages that make it ideal for implementing a network server from scratch. First, it provides comprehensive built-in libraries for socket programming through the `socket` module, eliminating the need for external dependencies. Second, Python's clear syntax allows for focusing on the implementation logic rather than dealing with low-level memory management issues common in languages like C++. Third, the language offers excellent string and byte manipulation capabilities, which are essential for parsing HTTP requests and constructing responses. Finally, Python's extensive standard library includes modules like `mimetypes`, `html`, and `urllib.parse` that simplify handling various HTTP-related tasks while keeping the codebase clean and maintainable.

### Analyzing the Requirements
The core challenge of implementing an HTTP server lies in understanding the HTTP protocol structure and implementing it correctly at the socket level. HTTP operates as a request-response protocol over TCP connections. An HTTP request consists of a request line (method, path, version), headers, and an optional body, all separated by CRLF sequences (`\r\n`). The server must parse these components, validate the request, process it, and send back an appropriately formatted response.

Security is paramount in web servers. Directory traversal attacks occur when malicious users attempt to access files outside the designated serving directory using path sequences like `../../../etc/passwd`. Preventing this requires careful path validation. Additionally, HTML escaping is necessary when displaying file listings to prevent cross-site scripting (XSS) attacks where malicious filenames containing JavaScript could be executed in users' browsers.

The HTTP/1.1 specification introduces chunked transfer encoding, which allows servers to send data without knowing the total content length beforehand. This is particularly useful for large files, as it enables streaming data efficiently without loading entire files into memory. Each chunk is prefixed with its size in hexadecimal, followed by the chunk data, and terminated with a zero-sized chunk.

### Implementing the HTTP Server
The server implementation is divided into two main modules: `httpserver.py` and `httphandler.py`. The first module handles the low-level socket operations, while the second focuses on HTTP protocol logic.

The server begins by creating a TCP socket and binding it to a specified host and port. The socket is then set to listen for incoming connections. When a client connects, the server accepts the connection, creating a new socket specifically for that client. This design allows the server to handle requests sequentially while maintaining clean separation between the listening socket and individual client connections.

```python
def start(self):
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((self.host, self.port))
    server_socket.listen(5)
    
    print(f"Server running on {self.host}:{self.port}")
    print(f"Serving files from: {os.path.abspath(self.directory)}")
    
    while True:
        client_socket, address = server_socket.accept()
        self.handle_client(client_socket, address)
```

The `start` method initializes the server socket with `SO_REUSEADDR` option, which allows immediate socket reuse after the server stops, preventing "Address already in use" errors. The `listen(5)` call sets the backlog queue size, allowing up to 5 pending connections. The main loop continuously accepts new connections and delegates their handling to the `handle_client` method.

### Implementing Request Buffering
One of the critical features is proper request buffering. Network data arrives in packets, and a single `recv()` call might not capture the entire HTTP request. The server must buffer incoming data until it detects the end of HTTP headers, marked by a double CRLF sequence (`\r\n\r\n`).

```python
def buffer_request(self, client_socket, timeout=5):
    client_socket.settimeout(timeout)
    buffer = b""
    
    while True:
        try:
            chunk = client_socket.recv(4096)
            if not chunk:
                break
            buffer += chunk
            
            if b"\r\n\r\n" in buffer:
                break
        except socket.timeout:
            break
    
    return buffer
```

This implementation reads data in 4KB chunks, which balances memory usage with efficiency. The timeout prevents the server from hanging indefinitely on slow or malicious clients. Once the double CRLF is detected, indicating the end of headers, the buffering stops. This approach ensures complete request reception before parsing begins, preventing issues with incomplete or fragmented requests.

### Implementing Path Security
Directory traversal prevention is implemented through careful path validation. The `safe_path_join` method ensures that the resolved absolute path remains within the designated serving directory.

```python
def safe_path_join(self, base_dir, requested_path):
    decoded_path = urllib.parse.unquote(requested_path)
    full_path = os.path.normpath(os.path.join(base_dir, decoded_path.lstrip('/')))
    real_base = os.path.realpath(base_dir)
    real_path = os.path.realpath(full_path)
    
    if not real_path.startswith(real_base):
        return None
    
    return real_path
```

The method first URL-decodes the requested path to handle encoded characters like `%2e%2e` (which represents `..`). It then normalizes the path using `os.path.normpath`, which resolves sequences like `../` and removes redundant separators. Finally, it uses `os.path.realpath` to resolve symbolic links and compares the real path with the real base directory. If the requested path falls outside the base directory, the method returns `None`, causing the server to respond with a 403 Forbidden error. This multi-layered approach effectively prevents directory traversal attacks while handling edge cases like symbolic links and encoded paths.

### Implementing Chunked Transfer Encoding
Chunked transfer encoding allows efficient streaming of large files without loading them entirely into memory. The implementation sends data in configurable chunk sizes, each prefixed with its size in hexadecimal.

```python
def send_chunked_response(self, client_socket, file_path, mime_type):
    headers = (
        "HTTP/1.1 200 OK\r\n"
        f"Content-Type: {mime_type}\r\n"
        "Transfer-Encoding: chunked\r\n"
        "Connection: close\r\n"
        "\r\n"
    )
    client_socket.sendall(headers.encode())
    
    chunk_size = 8192
    with open(file_path, 'rb') as f:
        while True:
            data = f.read(chunk_size)
            if not data:
                break
            
            chunk_header = f"{len(data):X}\r\n".encode()
            client_socket.sendall(chunk_header + data + b"\r\n")
    
    client_socket.sendall(b"0\r\n\r\n")
```

The method first sends HTTP headers indicating chunked encoding. It then reads the file in 8KB chunks, sending each chunk with its size in hexadecimal format. The chunk size is calculated using `len(data)` and formatted as hexadecimal with `:X`. After all data is sent, a final zero-sized chunk (`0\r\n\r\n`) signals the end of the response. This approach allows serving files of any size efficiently, as only one chunk resides in memory at a time.

### Implementing HTML Escaping
When generating directory listings, the server must escape HTML to prevent XSS attacks. Malicious users could upload files with names containing JavaScript code, which would execute in browsers viewing the directory listing.

```python
def generate_directory_listing(self, dir_path, request_path):
    items = []
    for item in sorted(os.listdir(dir_path)):
        item_path = os.path.join(dir_path, item)
        escaped_item = html.escape(item)
        
        if os.path.isdir(item_path):
            items.append(f'<li><a href="{escaped_item}/">{escaped_item}/</a></li>')
        else:
            items.append(f'<li><a href="{escaped_item}">{escaped_item}</a></li>')
```

The `html.escape()` function converts characters like `<`, `>`, and `&` into their HTML entity equivalents (`&lt;`, `&gt;`, `&amp;`). This ensures that filenames are displayed as text rather than interpreted as HTML code, preventing script injection. The escaping is applied both in the `href` attribute and the display text, maintaining security across all contexts where the filename appears.

### Implementation Showcase
The server runs on port 65432 and serves files from a designated directory. When started, it displays the serving directory and begins accepting connections.

![Server Screenshot](./report/images/1.png)

The screenshot demonstrates the server in action, showing a directory listing with proper HTML formatting. Users can navigate through directories by clicking folder names, and download files by clicking their names. The interface is clean and functional, with proper styling for readability.

When a client requests a file, the server determines the MIME type using the `mimetypes` module and sends the file with appropriate headers. For large files, chunked transfer encoding ensures efficient delivery without excessive memory usage. For directory requests, the server generates an HTML listing with escaped filenames, preventing security vulnerabilities while maintaining usability.

Error handling is comprehensive. If a requested path doesn't exist, the server responds with a 404 Not Found error. If a path traversal attempt is detected, a 403 Forbidden error is returned. For invalid requests or internal errors, appropriate 400 and 500 status codes are sent. Each error response includes a simple HTML page explaining the issue, improving user experience while maintaining security.

The server logs each request to the console, displaying the client address, HTTP method, requested path, and response status code. This logging facilitates debugging and monitoring, allowing administrators to track server activity and identify potential issues or attacks.

## Conclusion
This HTTP server implementation demonstrates fundamental networking concepts and HTTP protocol mechanics while maintaining security and efficiency. By building the server from scratch using socket programming, the project provides deep insight into how web servers operate at the protocol level.

The implementation successfully addresses all specified requirements. Request buffering ensures complete data reception before processing, preventing issues with fragmented requests. Directory traversal prevention through multi-layered path validation protects the filesystem from unauthorized access. HTML escaping in directory listings prevents XSS attacks, maintaining security for end users. Chunked transfer encoding enables efficient delivery of large files without excessive memory consumption.

The modular design separates concerns effectively, with socket management isolated from HTTP protocol logic. This separation enhances maintainability and allows for future extensions, such as supporting additional HTTP methods, implementing caching, or adding authentication mechanisms. The use of Python's standard library keeps the implementation lightweight and dependency-free while leveraging well-tested, reliable functionality.

This project serves as a solid foundation for understanding web server architecture and can be extended with features like concurrent connection handling using threading or asyncio, support for HTTPS through SSL/TLS, implementation of HTTP/2 protocol features, or integration with application frameworks for dynamic content generation. The core principles demonstrated here—protocol compliance, security awareness, and efficient resource management—remain applicable across all these potential enhancements.