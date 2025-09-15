#!/usr/bin/env python3
"""
Test script for QR code functionality in generate_softCopy.py
This script demonstrates how the QR code will be generated and what data it will contain.
"""

import json
from generate_softCopy import generate_certification_qr_code

def test_qr_code_generation():
    """Test the QR code generation with sample certification data."""
    
    # Sample certification data (similar to what would be passed to generate_softcopy)
    sample_cert_data = {
        "certification_body": "ABC",
        "accreditation_body": "ABC", 
        "certificate_number": "CERT-2024-001",
        "company_name": "Sample Company Ltd.",
        "certificate_standard": "ISO 9001:2015",
        "issue_date": "2024-01-15",
        "expiry_date": "2027-01-15"
    }
    
    print("🧪 [TEST] ===== QR CODE GENERATION TEST =====")
    print(f"🧪 [TEST] Input data: {json.dumps(sample_cert_data, indent=2)}")
    
    try:
        # Generate QR code
        qr_image = generate_certification_qr_code(sample_cert_data, size=200)
        
        # Save the QR code for testing
        output_path = "test_certification_qr.png"
        qr_image.save(output_path)
        
        print(f"✅ [TEST] QR code generated successfully!")
        print(f"✅ [TEST] QR code saved to: {output_path}")
        print(f"✅ [TEST] QR code dimensions: {qr_image.size}")
        
        # Show what data will be encoded in the QR code
        qr_data = {
            "Certification Body": sample_cert_data["certification_body"],
            "Accreditation Body": sample_cert_data["accreditation_body"],
            "Certificate Number": sample_cert_data["certificate_number"],
            "Company Name": sample_cert_data["company_name"],
            "Certificate Standard": sample_cert_data["certificate_standard"],
            "Registration Date": sample_cert_data["issue_date"],
            "Expiry Date": sample_cert_data["expiry_date"],
            "Issue Date": sample_cert_data["issue_date"]
        }
        
        print(f"\n🔍 [TEST] Data encoded in QR code:")
        print(json.dumps(qr_data, indent=2))
        
        print(f"\n📱 [TEST] When scanned, this QR code will display:")
        print(f"   • Certification Body: ABC (Always)")
        print(f"   • Accreditation Body: ABC (Always)")
        print(f"   • Certificate Number: {sample_cert_data['certificate_number']}")
        print(f"   • Company Name: {sample_cert_data['company_name']}")
        print(f"   • Certificate Standard: {sample_cert_data['certificate_standard']}")
        print(f"   • Registration Date: {sample_cert_data['issue_date']}")
        print(f"   • Expiry Date: {sample_cert_data['expiry_date']}")
        print(f"   • Issue Date: {sample_cert_data['issue_date']}")
        
    except Exception as e:
        print(f"❌ [TEST] Error generating QR code: {e}")
    
    print("🧪 [TEST] ===== END TEST =====")

if __name__ == "__main__":
    test_qr_code_generation()
