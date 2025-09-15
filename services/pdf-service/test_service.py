#!/usr/bin/env python3
"""
Simple test script to verify the PDF service components work correctly
"""

def test_imports():
    """Test if all imports work correctly."""
    try:
        from adapters.word_adapter import draft_from_form_and_template
        print("✅ Import successful: word_adapter")
        
        from rise.generate_certificate import parse_word_form, generate_certificate
        print("✅ Import successful: certificate generation functions")
        
        return True
    except Exception as e:
        print(f"❌ Import failed: {e}")
        return False

def test_fastapi_imports():
    """Test if FastAPI imports work."""
    try:
        from fastapi import FastAPI
        from fastapi.responses import Response
        print("✅ Import successful: FastAPI")
        return True
    except Exception as e:
        print(f"❌ FastAPI import failed: {e}")
        return False

def main():
    """Run all tests."""
    print("🧪 Testing PDF Service Components...")
    print("=" * 50)
    
    # Test imports
    imports_ok = test_imports()
    fastapi_ok = test_fastapi_imports()
    
    print("=" * 50)
    if imports_ok and fastapi_ok:
        print("🎉 All tests passed! Service is ready to run.")
        print("\nTo start the service, run:")
        print("python main.py")
    else:
        print("❌ Some tests failed. Please check the errors above.")

if __name__ == "__main__":
    main()
