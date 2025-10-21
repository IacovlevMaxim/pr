# Use Python 3.11 slim image as base
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy the application files
COPY src/httphandler.py .
COPY src/httpserver.py .

# Create a directory for serving files
RUN mkdir -p /serve

# Expose the default port
EXPOSE 65432

ENV PYTHONUNBUFFERED=1

# Set the default command to run the server
# By default, serve files from /serve directory
ENTRYPOINT ["python3", "httpserver.py"]
CMD ["--host", "0.0.0.0", "--port", "65432", "--dir", "/serve"]