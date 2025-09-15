#!/usr/bin/env python3
"""
Test script to check environment variables
"""

import os

def test_environment():
    print("🧪 Testing environment variables...")
    
    # Check specific variables
    internal_token = os.getenv("INTERNAL_TOKEN", "NOT_SET")
    pdf_service_url = os.getenv("PDF_SERVICE_URL", "NOT_SET")
    
    print(f"🔍 INTERNAL_TOKEN: '{internal_token}'")
    print(f"🔍 PDF_SERVICE_URL: '{pdf_service_url}'")
    
    # Check if .env.local exists
    env_file = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
    if os.path.exists(env_file):
        print(f"✅ .env.local file found at: {env_file}")
        with open(env_file, 'r') as f:
            content = f.read()
            print(f"📄 .env.local contents:")
            print(content)
    else:
        print(f"❌ .env.local file not found at: {env_file}")
        # Try alternative paths
        alt_paths = [
            os.path.join(os.path.dirname(__file__), "..", ".env.local"),
            os.path.join(os.path.dirname(__file__), ".env.local"),
            os.path.join(os.getcwd(), ".env.local")
        ]
        for alt_path in alt_paths:
            if os.path.exists(alt_path):
                print(f"🔍 Found .env.local at alternative path: {alt_path}")
                with open(alt_path, 'r') as f:
                    content = f.read()
                    print(f"📄 .env.local contents:")
                    print(content)
                break
    
    # List all environment variables
    print(f"\n🔍 All environment variables:")
    for key, value in os.environ.items():
        if "TOKEN" in key or "URL" in key:
            print(f"   {key}: {value}")

if __name__ == "__main__":
    test_environment()
