# QR Code Implementation for Certification PDFs

## Overview

This implementation adds QR code functionality to the `generate_softCopy.py` script. When a PDF is generated, a QR code containing certification information is automatically embedded at the specified coordinates.

## Features

- **Automatic QR Code Generation**: QR codes are generated automatically during PDF creation
- **Structured Data**: Contains all essential certification information in JSON format
- **Fixed Positioning**: QR code is placed at exact coordinates (498.7, 546, 567.4, 610)
- **High Error Correction**: Uses high error correction level for better scanning reliability
- **Graceful Fallback**: If QR code generation fails, PDF is still generated without it

## QR Code Content

When scanned, the QR code will display the following information:

```json
{
  "Certification Body": "Americo",
  "Accreditation Body": "UAF",
  "Certificate Number": "[From Certificate]",
  "Company Name": "[From Certificate]",
  "Certificate Standard": "[From Certificate]",
  "Registration Date": "[Issue Date]",
  "Expiry Date": "[Surveillance Date]",
  "Issue Date": "[Issue Date]"
}
```

### Field Mapping

| QR Code Field | Source Field | Notes |
|---------------|--------------|-------|
| Certification Body | Hardcoded | Always "Americo" |
| Accreditation Body | Hardcoded | Always "UAF" |
| Certificate Number | Certificate Number | From input values |
| Company Name | Company Name | From input values |
| Certificate Standard | ISO Standard | From input values |
| Registration Date | Issue Date | Same as Issue Date |
| Expiry Date | Surveillance Date | From input values |
| Issue Date | Issue Date | From input values |

## Coordinates

The QR code is positioned at:
- **X**: 498.7
- **Y**: 546
- **Width**: 68.7 (567.4 - 498.7)
- **Height**: 64 (610 - 546)

## Dependencies

The following packages are required:

```txt
qrcode[pil]
Pillow
```

## Installation

1. Install the required dependencies:
```bash
pip install qrcode[pil]
```

2. Ensure `Pillow` is already installed (it should be in your requirements.txt)

## Usage

### Automatic Integration

The QR code is automatically generated when you call `generate_softcopy()`. No additional code changes are needed in your existing workflow.

### Manual QR Code Generation

If you need to generate QR codes separately, you can use the provided functions:

```python
from generate_softCopy import generate_certification_qr_code, add_qr_code_to_pdf

# Generate QR code
cert_data = {
    "certification_body": "ABC",
    "accreditation_body": "ABC",
    "certificate_number": "CERT-001",
    "company_name": "Your Company",
    "certificate_standard": "ISO 9001:2015",
    "issue_date": "2024-01-01",
    "expiry_date": "2027-01-01"
}

qr_image = generate_certification_qr_code(cert_data, size=200)

# Save QR code to file
qr_image.save("certification_qr.png")

# Add to existing PDF
add_qr_code_to_pdf(pdf_document, qr_image, x, y, width, height)
```

## Testing

A test script `test_qr_code.py` is provided to verify the QR code functionality:

```bash
cd services/pdf-service/rise
python test_qr_code.py
```

This will:
1. Generate a sample QR code
2. Save it as `test_certification_qr.png`
3. Display the data that will be encoded
4. Show what users will see when scanning

## Error Handling

The implementation includes comprehensive error handling:

- **QR Generation Failures**: Logged as warnings, PDF generation continues
- **Image Insertion Failures**: Logged as warnings, PDF generation continues
- **Temporary File Cleanup**: Automatic cleanup of temporary files
- **Graceful Degradation**: PDF is always generated, even if QR code fails

## Logging

The system provides detailed logging for debugging:

```
🔍 [SOFTCOPY] Generating QR code with certification data...
✅ [SOFTCOPY] QR code added successfully at coordinates (498.7, 546, 567.4, 610)
🔍 [SOFTCOPY] QR code contains: {"Certification Body": "ABC", ...}
```

## Customization

### Changing QR Code Position

To change the QR code position, modify the coordinates in the `generate_softcopy` function:

```python
add_qr_code_to_pdf(
    pdf_document=doc,
    qr_image=qr_image,
    x=NEW_X,           # Change this
    y=NEW_Y,           # Change this
    width=NEW_WIDTH,   # Change this
    height=NEW_HEIGHT  # Change this
)
```

### Changing QR Code Size

To change the QR code size, modify the `size` parameter:

```python
qr_image = generate_certification_qr_code(cert_data, size=300)  # Change size here
```

### Adding Custom Fields

To add custom fields to the QR code, modify the `cert_data` dictionary and the `generate_certification_qr_code` function.

## Troubleshooting

### Common Issues

1. **Import Error for qrcode**: Ensure `qrcode[pil]` is installed
2. **PIL Import Error**: Ensure `Pillow` is installed
3. **QR Code Not Visible**: Check coordinates and ensure they're within PDF bounds
4. **QR Code Too Small/Large**: Adjust the `size` parameter

### Debug Mode

Enable debug logging by checking the console output for:
- QR code generation status
- Coordinate calculations
- Data encoding verification

## Performance Considerations

- **QR Code Generation**: Minimal overhead (~100ms for 200x200 QR code)
- **PDF Insertion**: Fast image insertion using PyMuPDF
- **Memory Usage**: Temporary files are automatically cleaned up
- **File Size**: QR code adds minimal size to final PDF

## Security Notes

- QR codes contain only the certification information provided
- No sensitive data beyond what's already in the PDF
- QR codes are generated locally, no external API calls
- Temporary files are securely cleaned up after use

## Future Enhancements

Potential improvements for future versions:

1. **Logo Integration**: Add company logos to QR codes
2. **Custom Styling**: Different colors and styles for QR codes
3. **Multiple QR Codes**: Support for multiple QR codes per PDF
4. **Dynamic Positioning**: Automatic positioning based on content
5. **Encryption**: Optional encryption of QR code data
