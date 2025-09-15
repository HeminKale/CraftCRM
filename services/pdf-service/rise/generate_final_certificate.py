import fitz  # PyMuPDF
import pypdf
import os
from datetime import datetime

def extract_text_from_pdf(pdf_path, coords, use_ocr_fallback=False):
    """Extract text from specific coordinates using text blocks, with optional OCR fallback."""
    extracted_data = {}

    try:
        doc = fitz.open(pdf_path)
        page = doc[0]

        for field_name, rect in coords.items():
            # First try block-based text extraction
            blocks = page.get_text("blocks", clip=rect)

            # Sort blocks top-down, then left-right
            blocks = sorted(blocks, key=lambda b: (round(b[1]), round(b[0])))

            # Combine non-empty block texts
            block_text = " ".join([b[4].strip() for b in blocks if b[4].strip()])

            # Remove watermark words like 'DRAFT' (case-insensitive)
            cleaned_text = block_text.replace('DRAFT', '').replace('draft', '').strip()
            # Remove double spaces caused by removal
            cleaned_text = ' '.join(cleaned_text.split())
            if cleaned_text != block_text:
                print(f"[INFO] Watermark removed for '{field_name}': '{cleaned_text}'")

            # Fallback to OCR if the block text looks like junk (single letters or too short)
            if use_ocr_fallback and (len(cleaned_text) < 10 or "\n" in cleaned_text or any(len(w) <= 2 for w in cleaned_text.split())):
                try:
                    import pytesseract
                    from PIL import Image
                    
                    pix = page.get_pixmap(clip=rect)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    ocr_text = pytesseract.image_to_string(img).strip()
                    print(f"🔁 OCR fallback used for '{field_name}'")
                    extracted_data[field_name] = ocr_text
                except (ImportError, Exception) as e:
                    print(f"⚠️ OCR not available ({str(e)}), using block text for '{field_name}'")
                    extracted_data[field_name] = cleaned_text
            else:
                extracted_data[field_name] = cleaned_text
            
            print(f"🔍 Extracted '{field_name}' from rect({rect.x0}, {rect.y0}, {rect.x1}, {rect.y1}): '{extracted_data[field_name]}'")
            
        doc.close()
        return extracted_data

    except Exception as e:
        print(f"❌ Error extracting text: {str(e)}")
        return {}

def extract_text_from_pdf_pypdf(pdf_path, coords):
    """Extract text from specific coordinates using pypdf"""
    extracted_data = {}

    try:
        # Open PDF with pypdf
        with open(pdf_path, 'rb') as file:
            pdf_reader = pypdf.PdfReader(file)
            page = pdf_reader.pages[0]  # First page
            
            # Get all text from the page
            page_text = page.extract_text()
            
            # For now, let's extract all text and print it to see the structure
            print(f"📄 Full page text from pypdf:")
            print("=" * 50)
            print(page_text)
            print("=" * 50)
            
            # For each field, we'll need to manually parse the text
            # This is a simplified approach - we'll extract based on keywords
            for field_name, rect in coords.items():
                if field_name == "Company Name":
                    # Look for company name patterns
                    lines = page_text.split('\n')
                    for line in lines:
                        if any(keyword in line.lower() for keyword in ['infotech', 'tech', 'ltd', 'inc', 'corp']):
                            print(f"[DEBUG] Company Name candidate line: {line}")
                            extracted_data[field_name] = line.strip()
                            break
                    else:
                        print(f"[DEBUG] No company name found in lines: {lines}")
                        extracted_data[field_name] = "Company name not found"
                        
                elif field_name == "Address":
                    # Look for address patterns
                    lines = page_text.split('\n')
                    found = False
                    for line in lines:
                        print(f"[DEBUG] Address candidate line: {line}")
                        if any(keyword in line.lower() for keyword in ['jalgaon', 'mumbai', 'delhi', 'bangalore']):
                            print(f"[DEBUG] Address matched: {line}")
                            extracted_data[field_name] = line.strip()
                            found = True
                            break
                    if not found:
                        print(f"[DEBUG] No address found in lines: {lines}")
                        extracted_data[field_name] = "Address not found"
                        
                elif field_name == "ISO Standard":
                    # Look for ISO standard patterns
                    if "ISO 22000:2018" in page_text:
                        extracted_data[field_name] = "ISO 22000:2018"
                    elif "ISO 9001" in page_text:
                        extracted_data[field_name] = "ISO 9001:2015"
                    else:
                        extracted_data[field_name] = "ISO Standard not found"
                        
                elif field_name == "Scope":
                    # Look for scope section - try multiple approaches
                    scope_text = "Scope not found"
                    print(f"[DEBUG] Full page text for Scope search: {page_text}")
                    # Method 1: Look for the pets text (since that's what we saw in the image)
                    if "pets are more than animals" in page_text.lower():
                        scope_start = page_text.lower().find("pets are more than animals")
                        scope_text = page_text[scope_start:scope_start+1000]  # Get 1000 chars after
                        print(f"[DEBUG] Scope found by pets phrase: {scope_text}")
                    # Method 2: Look for "scope" keyword
                    elif "scope" in page_text.lower():
                        scope_start = page_text.lower().find("scope")
                        scope_text = page_text[scope_start:scope_start+500]  # Get 500 chars after scope
                        print(f"[DEBUG] Scope found by 'scope' keyword: {scope_text}")
                    # Method 3: Look for "valid for the following" (common in certificates)
                    elif "valid for the following" in page_text.lower():
                        scope_start = page_text.lower().find("valid for the following")
                        scope_text = page_text[scope_start:scope_start+800]  # Get 800 chars after
                        print(f"[DEBUG] Scope found by 'valid for the following': {scope_text}")
                    # Method 4: Look for any long paragraph that might be scope
                    else:
                        lines = page_text.split('\n')
                        for i, line in enumerate(lines):
                            print(f"[DEBUG] Scope candidate line: {line}")
                            if len(line.strip()) > 100:  # Long line might be scope
                                print(f"[DEBUG] Scope matched long line: {line}")
                                scope_text = line.strip()
                                break
                    extracted_data[field_name] = scope_text.strip()
                        
                elif field_name == "management_system":
                    # Look for management system line
                    if "This is to certify that the" in page_text:
                        lines = page_text.split('\n')
                        for line in lines:
                            if "This is to certify that the" in line:
                                extracted_data[field_name] = line.strip()
                                break
                        else:
                            extracted_data[field_name] = "Management system not found"
                    else:
                        extracted_data[field_name] = "Management system not found"
                
                print(f"🔍 Extracted '{field_name}' using pypdf: '{extracted_data[field_name]}'")
            
        return extracted_data

    except Exception as e:
        print(f"❌ Error extracting text with pypdf: {str(e)}")
        return {}

def get_text_height(text, fontsize, fontname, max_width):
    """Calculate text height for wrapping"""
    font = fitz.Font(fontname=fontname)
    words = text.split()
    lines = []
    current_line = ""
    
    for word in words:
        test_line = current_line + (" " if current_line else "") + word
        if font.text_length(test_line, fontsize) <= max_width:
            current_line = test_line
        else:
            lines.append(current_line)
            current_line = word
    
    if current_line:
        lines.append(current_line)
    
    return len(lines) * fontsize * 1.0

def insert_centered_textbox(page, rect, text, fontname, fontsize, color):
    """Insert text centered in a rectangle with wrapping"""
    # Calculate center position
    center_x = rect.x0 + rect.width / 2
    center_y = rect.y0 + rect.height / 2
    
    # Use exact center - insert_text positions by baseline, so center_y should work
    # Debug: Print text insertion coordinates
    print(f"🔍 DEBUG: Text insertion coordinates: ({center_x:.2f}, {center_y:.2f})")
    print(f"🔍 DEBUG: Rectangle center: ({center_x:.2f}, {center_y:.2f})")
    
    # Use insert_text instead of insert_textbox for better reliability
    page.insert_text(
        (center_x, center_y), text,
        fontsize=fontsize, fontname=fontname, color=color
    )

def generate_final_certificate(draft_pdf_path, output_pdf_path, extracted_data, date_fields):
    """It certificate from draft PDF and date fields"""
    try:
        # Use Final.pdf from the same directory as the script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        final_template_path = os.path.join(script_dir, "Final.pdf")
        
        # Open the final template
        doc = fitz.open(final_template_path)
        page = doc[0]
        
        # Define coordinates for fields in Final.pdf template
        coords = {
            "management_system": fitz.Rect(87.9, 185, 580, 226.6),  # Combined rectangle
            "Company Name and Address": fitz.Rect(87.9, 227.6, 580, 313),  # Combined rectangle
            "ISO Standard": fitz.Rect(194.9, 334, 460.3, 370),  # Moved up by 30 points
            "Scope": fitz.Rect(87.9, 386, 580, 475),
        }
        
        # Define coordinates for date fields in final template
        date_coords = {
            "Certificate Number": fitz.Rect(363, 478, 580, 492),
            "Original Issue Date": fitz.Rect(363, 501, 580, 513),
            "Issue Date": fitz.Rect(363, 518, 580, 530),
            "Surveillance/Expiry Date": fitz.Rect(363, 535, 580, 547),
            "Recertification Date": fitz.Rect(363, 550, 580, 562),
        }
        
        # Font settings
        fontname = "Times-Bold"  # Use bold font like in draft generation
        color = (0, 0, 0)  # Black
        
        # Insert extracted data from draft
        print(f"🔍 DEBUG: Extracted data keys: {list(extracted_data.keys())}")
        print(f"🔍 DEBUG: Available coords keys: {list(coords.keys())}")
        
        # Handle Company Name and Address combination first
        company_name = extracted_data.get("Company Name", "")
        address = extracted_data.get("Address", "")
        if company_name and address:
            combined_text = f"{company_name}\n{address}"
            if "Company Name and Address" in coords:
                rect = coords["Company Name and Address"]
                print(f"🔍 DEBUG: Processing combined 'Company Name and Address' with text: '{combined_text[:50]}...'")
                start_size = 30
                font_size = start_size
                # Reduce font size if needed to fit
                while font_size >= 10:
                    text_height = get_text_height(combined_text, font_size, fontname, rect.width)
                    if text_height <= rect.height:
                        break
                    font_size -= 1
                # Debug: Print rectangle coordinates
                print(f"🔍 DEBUG: Green rectangle coordinates: {rect}")
                # Center horizontally using text width
                try:
                    font_obj = fitz.Font(fontname=fontname)
                except Exception as e:
                    print(f"⚠️ Font '{fontname}' not available for Company Name and Address, using Times-Bold. Error: {e}")
                    fontname = "Times-Bold"
                    font_obj = fitz.Font(fontname=fontname)
                lines = combined_text.split("\n")
                total_height = len(lines) * font_size
                start_y = rect.y0 + (rect.height - total_height) / 2 + font_size/3
                for i, line in enumerate(lines):
                    text_width = font_obj.text_length(line, font_size)
                    center_x = (rect.x0 + rect.x1) / 2
                    start_x = center_x - text_width / 2
                    y = start_y + i * font_size
                    page.insert_text((start_x, y), line, fontsize=font_size, fontname=fontname, color=color)
            print(f"✅ Company Name and Address: Font size {font_size}pt (centered)")
            # page.draw_rect(rect, color=(0, 1, 0), width=2)  # Green rectangle - commented out

        # Process ISO Standard and Scope, then management_system after ISO Standard
        iso_standard_text = extracted_data.get("ISO Standard", "")
        if iso_standard_text and "ISO Standard" in coords:
            rect = coords["ISO Standard"]
            print(f"🔍 DEBUG: Processing field 'ISO Standard' with text: '{iso_standard_text[:50]}...'")
            start_size = 30
            font_size = start_size
            while font_size >= 10:
                text_height = get_text_height(iso_standard_text, font_size, fontname, rect.width)
                if text_height <= rect.height:
                    break
                font_size -= 1
            print(f"🔍 DEBUG: Green rectangle coordinates for ISO Standard: {rect}")
            try:
                font_obj = fitz.Font(fontname=fontname)
            except Exception as e:
                print(f"⚠️ Font '{fontname}' not available for ISO Standard, using Times-Bold. Error: {e}")
                fontname = "Times-Bold"
                font_obj = fitz.Font(fontname=fontname)
            text_width = font_obj.text_length(iso_standard_text, font_size)
            center_x = (rect.x0 + rect.x1) / 2
            center_y = (rect.y0 + rect.y1) / 2 + font_size/3
            start_x = center_x - text_width / 2
            page.insert_text((start_x, center_y), iso_standard_text, fontsize=font_size, fontname=fontname, color=color)
            print(f"✅ ISO Standard: Font size {font_size}pt (centered)")
            # page.draw_rect(rect, color=(0, 1, 0), width=2)  # Green rectangle - commented out

        # management_system after ISO Standard
        management_text = extracted_data.get("management_system", "")
        if management_text and "management_system" in coords:
            rect = coords["management_system"]
            fontname = "Times-BoldItalic"
            fontsize = 15
            color = (0, 0, 0)
            try:
                font_obj = fitz.Font(fontname=fontname)
            except Exception as e:
                print(f"⚠️ Font '{fontname}' not available for management_system, using Times-Bold. Error: {e}")
                fontname = "Times-Bold"
                font_obj = fitz.Font(fontname=fontname)
            center_x = (rect.x0 + rect.x1) / 2
            center_y = (rect.y0 + rect.y1) / 2 + fontsize/3
            text_width = font_obj.text_length(management_text, fontsize)
            start_x = center_x - text_width / 2
            page.insert_text((start_x, center_y), management_text, fontsize=fontsize, fontname=fontname, color=color)
            print(f"✅ management_system: Font size {fontsize}pt ({fontname}, centered)")
            # page.draw_rect(rect, color=(0, 1, 0), width=2)  # Green rectangle - commented out

        # Scope
        scope_text = extracted_data.get("Scope", "")
        if scope_text and "Scope" in coords:
            rect = coords["Scope"]
            fontname = "Times-Bold"  # Ensure Scope is not italic
            print(f"🔍 DEBUG: Processing field 'Scope' with text: '{scope_text[:50]}...'")
            start_size = 9
            font_size = start_size
            while font_size >= 8:
                text_height = get_text_height(scope_text, font_size, fontname, rect.width)
                if text_height <= rect.height:
                    break
                font_size -= 1
            print(f"🔍 DEBUG: Green rectangle coordinates for Scope: {rect}")
            try:
                font_obj = fitz.Font(fontname=fontname)
                # Print the font style for Scope
                print(f"[INFO] Using font for Scope: {fontname}")
                if 'Bold' in fontname and 'Italic' in fontname:
                    print("[INFO] Scope font style: Bold Italic")
                elif 'Bold' in fontname:
                    print("[INFO] Scope font style: Bold")
                elif 'Italic' in fontname:
                    print("[INFO] Scope font style: Italic")
                else:
                    print("[INFO] Scope font style: Regular")
            except Exception as e:
                print(f"⚠️ Font '{fontname}' not available for Scope, using Times-Bold. Error: {e}")
                fontname = "Times-Bold"
                font_obj = fitz.Font(fontname=fontname)
                print(f"[INFO] Fallback font for Scope: {fontname} (Bold)")
            # PowerPoint-style centering with automatic font size reduction
            words = scope_text.split()
            lines = []
            current_line = ""
            for word in words:
                test_line = current_line + (" " if current_line else "") + word
                if font_obj.text_length(test_line, font_size) <= rect.width:
                    current_line = test_line
                else:
                    if current_line:
                        lines.append(current_line)
                    current_line = word
            if current_line:
                lines.append(current_line)
            line_height = font_size * 1.0
            total_height = len(lines) * line_height
            start_y = rect.y0 + (rect.height - total_height) / 2 + font_size/3
            for i, line in enumerate(lines):
                text_width = font_obj.text_length(line, font_size)
                center_x = (rect.x0 + rect.x1) / 2
                start_x = center_x - text_width / 2
                y = start_y + i * line_height
                page.insert_text((start_x, y), line, fontsize=font_size, fontname=fontname, color=color)
            print(f"✅ Scope: Font size {font_size}pt (centered)")
            # page.draw_rect(rect, color=(0, 1, 0), width=2)  # Green rectangle - commented out
        
        # Insert date fields with Bodoni MT 14pt font
        for field, value in date_fields.items():
            if field in date_coords and value:
                rect = date_coords[field]
                manual_fontname = "BodoniMT"  # Remove space from font name
                try:
                    test_font = fitz.Font(fontname=manual_fontname)
                    print(f"[INFO] Using font for manual fields: {manual_fontname}")
                except:
                    manual_fontname = "Times-Roman"
                    print(f"[INFO] Bodoni MT not found. Falling back to: {manual_fontname}")
                manual_font_size = 14  # Static and fixed size
                # To get Bodoni MT font: On Windows, it is often pre-installed. If not, you can download it from Microsoft Store or trusted font sites. On Mac, it's usually included. For Linux, you may need to manually install the .ttf file and register it with your system fonts.
                # Calculate center position for proper centering
                center_x = (rect.x0 + rect.x1) / 2
                center_y = (rect.y0 + rect.y1) / 2 + manual_font_size/3  # Adjust for baseline
                try:
                    font_obj = fitz.Font(fontname=manual_fontname)
                    text_width = font_obj.text_length(value, manual_font_size)
                    start_x = rect.x0 + 2  # 2 pixels from left edge for some padding
                except:
                    start_x = rect.x0 + 2
                page.insert_text(
                    (start_x, center_y), value,
                    fontsize=manual_font_size, fontname=manual_fontname, color=color
                )
                print(f"✅ {field}: {value} (Bodoni MT 14pt, left-aligned)")
        
        # Save the final certificate
        doc.save(output_pdf_path)
        doc.close()
        
        print(f"✅ Final certificate saved at: {output_pdf_path}")
        return True
        
    except Exception as e:
        print(f"❌ Error generating final certificate: {str(e)}")
        return False

def extract_from_draft_pdf(draft_pdf_path):
    """Extract data from draft PDF"""
    # Define coordinates for extracting from draft PDF
    draft_coords = {
        "Company Name": fitz.Rect(179.2, 233.6, 476.0, 266.4),
        "Address": fitz.Rect(169.4, 280, 485.9, 295),  # Adjusted to avoid extra text
        "ISO Standard": fitz.Rect(194.9, 350, 460.3, 365),  # Adjusted to avoid RAFT
        "Scope": fitz.Rect(50, 380, 545, 420),  # Adjusted to get proper scope area
        "management_system": fitz.Rect(87.9, 185, 580, 226.6),  # Management system line
    }
    # Try PyMuPDF rectangle-based extraction first, fallback to pypdf if needed
    try:
        print("[INFO] Trying PyMuPDF rectangle-based extraction for all fields...")
        return extract_text_from_pdf(draft_pdf_path, draft_coords)
    except Exception as e:
        print(f"⚠️ PyMuPDF failed, trying pypdf keyword/phrase extraction: {str(e)}")
        return extract_text_from_pdf_pypdf(draft_pdf_path, draft_coords)

if __name__ == "__main__":
    # Example usage
    draft_pdf = "path/to/draft.pdf"
    final_template = "Final.pdf"  # Use Final.pdf from same directory
    output_pdf = "path/to/final_certificate.pdf"
    
    # Extract data from draft
    extracted_data = extract_from_draft_pdf(draft_pdf)
    
    # Date fields (these would come from GUI)
    date_fields = {
        "Certificate Number": "CERT-2024-001",
        "Issue Date": "15/01/2024",
        "Original Issue Date": "15/01/2021",
        "Surveillance/Expiry Date": "15/01/2027",
        "Recertification Date": "15/01/2024",
    }
    
    # Generate final certificate
    success = generate_final_certificate(draft_pdf, output_pdf, extracted_data, date_fields)
    
    if success:
        print("🎉 Final certificate generated successfully!")
    else:
        print("❌ Failed to generate final certificate") 