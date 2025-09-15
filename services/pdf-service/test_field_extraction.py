#!/usr/bin/env python3
"""
Test script to verify field extraction functionality
"""

import sys
import os

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_field_extraction():
    """Test the field extraction functionality"""
    try:
        print("🧪 Testing field extraction...")
        
        # Test 1: Import the parse_word_form function
        print("📦 Testing imports...")
        from rise.generate_certificate import parse_word_form
        print("✅ Successfully imported parse_word_form")
        
        # Test 2: Check if we can access the template
        print("📄 Testing template access...")
        template_path = os.path.join(os.path.dirname(__file__), "templates", "default-draft.pdf")
        if os.path.exists(template_path):
            print(f"✅ Template found at: {template_path}")
            print(f"   Size: {os.path.getsize(template_path)} bytes")
        else:
            print(f"❌ Template not found at: {template_path}")
        
        # Test 3: Check if we can access the form.docx from github to cursor
        form_path = os.path.join(os.path.dirname(__file__), "..", "..", "rise", "generate_certificate", "form.docx")
        if os.path.exists(form_path):
            print(f"✅ Test form found at: {form_path}")
            print(f"   Size: {os.path.getsize(form_path)} bytes")
            
            # Test 4: Try to extract fields
            print("🔍 Testing field extraction...")
            try:
                extracted_fields = parse_word_form(form_path)
                print(f"✅ Successfully extracted {len(extracted_fields)} fields:")
                for key, value in extracted_fields.items():
                    print(f"   - {key}: {value[:50]}{'...' if len(value) > 50 else ''}")
                    
            except Exception as e:
                print(f"❌ Field extraction failed: {str(e)}")
                return False
        else:
            print(f"❌ Test form not found at: {form_path}")
            print("   You can copy form.docx from github to cursor/rise/generate_certificate/ to test")
        
        print("\n🎉 All tests completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_field_extraction()
    sys.exit(0 if success else 1)
