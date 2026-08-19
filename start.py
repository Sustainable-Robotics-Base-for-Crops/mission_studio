#!/usr/bin/env python3
"""
Startup script for the public core of Trajectory Editor.
"""

import sys

def start_server():
    """Start the Trajectory Editor server"""
    print("Starting the Trajectory Editor server...")

    try:
        # Import and start the server
        from server import run_server
        run_server()
    except KeyboardInterrupt:
        print("\nServer stopped")
        sys.exit(0)
    except Exception as e:
        print(f"Error while starting the server: {e}")
        sys.exit(1)

def main():
    """Main function"""
    print("Trajectory Editor")
    print("=" * 40)

    # Start the server
    start_server()

if __name__ == "__main__":
    main()