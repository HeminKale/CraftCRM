import os
import json
import tempfile
import requests
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from rise.generate_certificate import parse_word_form, parse_pdf_form, generate_certificate
from datetime import datetime, timedelta

# Load environment variables from .env.local
def load_env_file():
    # Look for .env.local in the Craft App root directory (2 levels up from pdf-service)
    env_file = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
    if os.path.exists(env_file):
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key] = value
    else:
        # Try alternative paths
        alt_paths = [
            os.path.join(os.path.dirname(__file__), "..", ".env.local"),
            os.path.join(os.path.dirname(__file__), ".env.local"),
            os.path.join(os.getcwd(), ".env.local")
        ]
        for alt_path in alt_paths:
            if os.path.exists(alt_path):
                with open(alt_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, value = line.split('=', 1)
                            os.environ[key] = value
                break

# Load environment variables
load_env_file()

# Get environment variables after loading
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")

# Validate required environment variables
if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise ValueError("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set")

if not INTERNAL_TOKEN:
    raise ValueError("INTERNAL_TOKEN must be set")

app = FastAPI(title="PDF/Certificate Service", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "PDF Service", "port": 8000, "endpoints": ["/extract-fields", "/generate-certificate", "/generate-softcopy", "/draft", "/convert", "/generate-certificate-json"]}

async def download_template_from_supabase(template_name: str) -> str:
    """Download a PDF template from Supabase storage."""
    try:
        # Construct the download URL
        download_url = f"{SUPABASE_URL}/storage/v1/object/public/certificate-templates/{template_name}.pdf"
        
        # Download the template
        response = requests.get(download_url)
        response.raise_for_status()
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
            tmp_file.write(response.content)
            return tmp_file.name
            
    except Exception as e:
        raise Exception(f"Failed to download template {template_name}: {str(e)}")

@app.middleware("http")
async def verify_internal_token(request: Request, call_next):
    # Skip token check for health endpoint
    if request.url.path in ["/health"]:
        return await call_next(request)
    
    # Get token from request headers
    token = request.headers.get("x-internal-token")
    
    # Debug logging
    print(f"🔍 [AUTH] Request to: {request.url.path}")
    print(f"🔍 [AUTH] Received token: '{token}'")
    print(f"🔍 [AUTH] Expected token: '{INTERNAL_TOKEN}'")
    print(f"🔍 [AUTH] Tokens match: {token == INTERNAL_TOKEN}")
    
    # Check if token matches environment variable
    if token != INTERNAL_TOKEN:
        print(f"❌ [AUTH] Token mismatch - received: '{token}', expected: '{INTERNAL_TOKEN}'")
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    return await call_next(request)

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "PDF/Certificate Service"}

@app.post("/extract-fields")
async def extract_fields(form: UploadFile = File(...)):
    """Extract form fields from Word document, PDF, or image without generating PDF."""
    
    # Validate file types
    file_extension = form.filename.lower().split('.')[-1] if '.' in form.filename else ""
    supported_extensions = ['docx', 'pdf', 'png', 'jpg', 'jpeg']
    
    if file_extension not in supported_extensions:
        raise HTTPException(status_code=400, detail="Form must be .docx, .pdf, .png, or .jpg format")
    
    try:
        # Save uploaded file temporarily with appropriate extension
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}") as tmp_file:
            content = await form.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        try:
            # Extract fields based on file type
            if file_extension == "docx":
                extracted_fields = parse_word_form(tmp_file_path)
            elif file_extension in ["pdf", "png", "jpg", "jpeg"]:
                extracted_fields = parse_pdf_form(tmp_file_path)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_extension}")
            
            # Clean up temporary file
            os.unlink(tmp_file_path)
            
            return extracted_fields
            
        except Exception as e:
            # Clean up temporary file on error
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
            raise e
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Field extraction failed: {str(e)}")

@app.post("/generate-certificate")
async def generate_certificate_endpoint(
    request: Request,
    form: UploadFile = File(...),
    fields: str = Form(...)
):
    """Generate certificate from form and field data using Supabase template."""
    # Validate file types
    file_extension = form.filename.lower().split('.')[-1] if '.' in form.filename else ""
    supported_extensions = ['docx', 'pdf', 'png', 'jpg', 'jpeg']
    
    if file_extension not in supported_extensions:
        raise HTTPException(status_code=400, detail="Form must be .docx, .pdf, .png, or .jpg format")
    
    try:
        # Parse field data
        if not fields or fields.strip() == "":
            raise HTTPException(status_code=400, detail="Field data is empty or missing")
        
        try:
            field_data = json.loads(fields)
            if field_data is None:
                raise HTTPException(status_code=400, detail="Field data is null")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid field data format")
        
        # ✅ ADDED: Extract logo files from form data
        # Note: Logo files are sent separately in the form data
        logo_lookup = {}  # Will be populated by the frontend
        
        # ✅ FIXED: Extract new optional fields with EXACT field name matching (same as soft copy)
        initial_registration_date = field_data.get("Initial Registration Date", "")
        surveillance_due_date = field_data.get("Surveillance Due Date", "")
        expiry_date = field_data.get("Expiry Date", "")
        certificate_number = field_data.get("Certificate Number", "")
        original_issue_date = field_data.get("Original Issue Date", "")
        issue_date = field_data.get("Issue Date", "")
        surveillance_date = field_data.get("Surveillance/ Expiry Date", "")
        recertification_date = field_data.get("Recertification Date", "")
        # ✅ ADDED: Extract Extra Line field
        extra_line = field_data.get("Extra Line", "")
        # ✅ ADDED: Extract Address alignment field
        address_alignment = field_data.get("Address alignment", "")
        # ✅ ADDED: Extract Language field (S or blank)
        language = field_data.get("Language", "").strip().lower()
        

        
        # ✅ ADDED: Extract logo files from form data
        # The frontend sends logo files via logo_files field
        try:
            form_data = await request.form()
            logo_files = form_data.getlist("logo_files") if hasattr(form_data, 'getlist') else []
            
            # Create logo lookup dictionary
            for logo_file in logo_files:
                if hasattr(logo_file, 'filename') and logo_file.filename:
                    logo_lookup[logo_file.filename] = logo_file
        except Exception as logo_error:
            logo_lookup = {}
        
        # Save uploaded file temporarily with appropriate extension
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}") as tmp_file:
            content = await form.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        try:
            # Create output file path
            output_filename = f"generated_certificate_{os.getpid()}.pdf"
            output_path = os.path.join(tempfile.gettempdir(), output_filename)
            
            # ✅ NEW: Check for Extra Line presence FIRST (highest priority)
            extra_line = field_data.get("Extra Line", "").strip()
            
            # Analyze Scope content, Size, Accreditation, Logo, and Country to determine template selection
            scope_text = field_data.get("Scope", "")
            scope_words = len(scope_text.split())
            
            # ✅ DEBUG: Size field processing
            raw_size = field_data.get("Size", "")
            size = raw_size.lower().strip()
            
            
            accreditation = field_data.get("Accreditation", "").lower().strip()
            logo = field_data.get("Logo", "").lower().strip()
            country = field_data.get("Country", "").strip()  # ✅ ADDED: Country parameter
            
            # Calculate estimated lines for Scope (approximate calculation)
            estimated_lines = max(1, (scope_words * 8) // 60)  # Rough estimate: 8 chars per word, 60 chars per line
            
            # DEBUG: Template selection analysis
            
            
            # Determine template based on Size, Accreditation, Logo, Country, and content length
            # ✅ UPDATED: Check if logo filename exists in logo lookup instead of "yes"/"no"
            logo_filename = field_data.get("Logo", "").strip()
            
            # ✅ NEW: Template Override Logic - Extra Line forces large template
            if extra_line:
                print(f"🔍 [CERTIFICATE] Extra Line present - forcing large template selection")
                
                # Force large template based on other parameters
                if country.lower() == "other":
                    if accreditation == "no":
                        template_name = "templateDraftLargeNonAccOther"
                        template_type = "large_nonaccredited_other"
                    elif size == "high":
                        template_name = "template_draft_large_other"
                        template_type = "large_other"
                    else:
                        template_name = "template_draft_large_other_eco"
                        template_type = "large_other_eco"
                else:  # Default country
                    if logo_filename and logo_filename in logo_lookup:
                        if accreditation == "no":
                            template_name = "templateDraftLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templateDraftLogo"
                            template_type = "logo"
                    elif accreditation == "no":
                        template_name = "templateDraftLargeNonAcc"
                        template_type = "large_nonaccredited"
                    elif size == "high":
                        template_name = "template_draft_large"
                        template_type = "large"
                    else:
                        template_name = "templateDraftLargeEco"
                        template_type = "large_eco"
                
                print(f"🔍 [CERTIFICATE] Extra Line override: {template_name} ({template_type})")
                
            else:
                # ✅ EXISTING: Normal template selection logic
                # ✅ ADDED: Country = "Other" template logic with logo templates
                if country.lower() == "other":
                    if logo_filename and logo_filename in logo_lookup:
                        # Logo templates for Other country
                        if accreditation == "no":
                            template_name = "templateDraftLogoNonAccOther"
                            template_type = "logo_nonaccredited_other"
                        else:
                            template_name = "templateDraftLogoOther"
                            template_type = "logo_other"
                    elif accreditation == "no":
                        # Non-accredited templates for Other country
                        if estimated_lines <= 11:
                            template_name = "templateDraftStandardNonAccOther"
                            template_type = "standard_nonaccredited_other"
                        else:
                            template_name = "templateDraftLargeNonAccOther"
                            template_type = "large_nonaccredited_other"
                        print(f"[DEBUG] [TEMPLATE SELECTION] Decision: OTHER COUNTRY NON-ACCREDITED TEMPLATE")
                        print(f"[DEBUG] [TEMPLATE SELECTION] Reason: Country = 'Other' AND accreditation = 'no'")
                    elif size == "high" and accreditation != "no":
                        # High size with accreditation for Other country
                        if estimated_lines <= 11:
                            template_name = "template_draft_other"
                            template_type = "standard_other"
                        else:
                            template_name = "template_draft_large_other"
                            template_type = "large_other"
                    else:
                        # Size is blank/low and accreditation != no for Other country - use eco templates
                        if estimated_lines <= 11:
                            template_name = "template_draft_other_eco"
                            template_type = "standard_other_eco"
                        else:
                            template_name = "template_draft_large_other_eco"
                            template_type = "large_other_eco"
                else:
                    # ✅ ADDED: Logo handling logic (applies to both blank and Other country)
                    if logo_filename and logo_filename in logo_lookup:
                        # Logo templates take priority - single template regardless of content length
                        if accreditation == "no":
                            template_name = "templateDraftLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templateDraftLogo"
                            template_type = "logo"
                    elif logo_filename and logo_filename not in logo_lookup:
                        print(f"⚠️ [CERTIFICATE] Logo specified but file not found: {logo_filename} - using regular template")
                        # Continue with regular template selection logic
                    elif accreditation == "no":
                        # Non-accredited templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templateDraftStandardNonAcc"
                            template_type = "standard_nonaccredited"
                        else:  # Large template for >11 lines
                            template_name = "templateDraftLargeNonAcc"
                            template_type = "large_nonaccredited"
                    elif size == "high" and accreditation != "no":
                        # High size with accreditation - use current templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "template_draft"
                            template_type = "standard"
                        else:  # Large template for >11 lines
                            template_name = "template_draft_large"
                            template_type = "large"
                    else:
                        # Size is blank/low and accreditation != no - use eco templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templateDraftStandardEco"
                            template_type = "standard_eco"
                        else:  # Large template for >11 lines
                            template_name = "templateDraftLargeEco"
                            template_type = "large_eco"
            
            # ✅ ADDED: Apply Language S prefix logic AFTER template selection
            if language == "s":
                template_name = f"S_{template_name}"
                print(f"🔍 [CERTIFICATE] Language: Spanish (S) - using template: {template_name}")
            else:
                print(f"🔍 [CERTIFICATE] Language: English (default) - using template: {template_name}")
            
            # Download template from Supabase storage
            template_path = await download_template_from_supabase(template_name)
            
            # ✅ ADDED: Add logo lookup to field_data for the generation function
            field_data["logo_lookup"] = logo_lookup
            print(f"🔍 [CERTIFICATE] Added logo lookup to field data: {len(logo_lookup)} logo files")
            
            # ✅ ADDED: Add new optional fields to field data
            field_data["Initial Registration Date"] = initial_registration_date
            field_data["Surveillance Due Date"] = surveillance_due_date
            field_data["Expiry Date"] = expiry_date
            field_data["Certificate Number"] = certificate_number
            field_data["Original Issue Date"] = original_issue_date
            field_data["Issue Date"] = issue_date
            field_data["Surveillance/ Expiry Date"] = surveillance_date
            field_data["Recertification Date"] = recertification_date
            # ✅ ADDED: Add Extra Line field to field data
            field_data["Extra Line"] = extra_line
            # ✅ ADDED: Add Language field to field data
            field_data["Language"] = language
            print(f"🔍 [CERTIFICATE] Added new optional fields to field data")
            
            # ✅ FIXED: Create a proper values dictionary like soft copy does
            # This ensures field_data is never None and has all required fields
            values = field_data.copy()
            print(f"🔍 [CERTIFICATE] Created values dictionary with {len(values)} fields")

            # Generate certificate with template type information
            # Call the generate_certificate function and capture return value
            # ✅ FIXED: Add safety check for values before calling generate_certificate
            if values is None:
                raise HTTPException(status_code=400, detail="Values is null - cannot generate certificate")
            
            result = generate_certificate(template_path, output_path, values, template_type)
            
            # Check for overflow warnings
            if result.get("overflow_warnings"):
                print(f"[CERTIFICATE] ===== OVERFLOW WARNINGS =====")
                for warning in result["overflow_warnings"]:
                    print(f"[CERTIFICATE] {warning['message']}")
                print(f"[CERTIFICATE] ===== END OVERFLOW WARNINGS =====")
            
            # Read the generated PDF
            with open(output_path, "rb") as f:
                pdf_bytes = f.read()
            
            # Clean up temporary files
            os.unlink(tmp_file_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
            if os.path.exists(template_path):
                os.unlink(template_path)
            
            # Check if we have overflow warnings to include in response headers
            warning_headers = {}
            if 'result' in locals() and result.get("overflow_warnings"):
                warning_messages = [w["message"] for w in result["overflow_warnings"]]
                warning_header = " | ".join(warning_messages)
                warning_headers["X-Overflow-Warnings"] = warning_header
            
            return Response(
                pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{output_filename}"',
                    **warning_headers
                }
            )
            
        except Exception as e:
            # Clean up temporary file on error
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
            raise e
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Certificate generation failed: {str(e)}")

@app.post("/draft")
async def draft(form: UploadFile = File(...), template: UploadFile = File(...)):
    """Generate draft certificate from Word form and PDF template."""
    # Validate file types
    if not form.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Form must be .docx format")
    if not template.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Template must be .pdf format")
    
    try:
        pdf_bytes, out_name = await draft_from_form_and_template(form, template)
        return Response(
            pdf_bytes, 
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{out_name}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Certificate generation failed: {str(e)}")

@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    """Convert single Word document to PDF."""
    if not file.filename.lower().endswith((".doc", ".docx")):
        raise HTTPException(status_code=400, detail="File must be .doc or .docx format")
    
    try:
        pdf_bytes, out_name = await convert_single_word(file)
        return Response(
            pdf_bytes,
            media_type="application/pdf", 
            headers={"Content-Disposition": f'attachment; filename="{out_name}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")

@app.post("/generate-softcopy")
async def generate_softcopy_endpoint(
    request: Request,
    data: str = Form(...),
    template: UploadFile = File(None)
):
    """Generate soft copy PDF from form data using Supabase template."""
    try:
        # ENHANCED LOGGING: Log raw data received
      
        # ✅ FIXED: Add safety check for empty/missing data
        if not data or data.strip() == "":
            raise HTTPException(status_code=400, detail="Data is empty or missing")
        
        # Parse the JSON data
        try:
            soft_copy_data = json.loads(data)
            if soft_copy_data is None:
                raise HTTPException(status_code=400, detail="Data is null")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid data format")
        
        # ENHANCED LOGGING: Log parsed JSON data
        
        # Extract fields - FIXED: Use correct field names that match Next.js API
        company_name = soft_copy_data.get("Company Name", "")
        address = soft_copy_data.get("Address", "")
        iso_standard = soft_copy_data.get("ISO Standard", "")
        scope = soft_copy_data.get("Scope", "")
        certificate_number = soft_copy_data.get("Certificate Number", "")
        original_issue_date = soft_copy_data.get("Original Issue Date", "")
        issue_date = soft_copy_data.get("Issue Date", "")
        surveillance_date = soft_copy_data.get("Surveillance/ Expiry Date", "")
        recertification_date = soft_copy_data.get("Recertification Date", "")
        # ✅ ADDED: Extract Revision field
        revision = soft_copy_data.get("Revision", "")
        # ✅ ADDED: Extract the 3 new optional fields
        initial_registration_date = soft_copy_data.get("Initial Registration Date", "")
        surveillance_due_date = soft_copy_data.get("Surveillance Due Date", "")
        expiry_date = soft_copy_data.get("Expiry Date", "")
        # ✅ ADDED: Extract Extra Line field
        extra_line = soft_copy_data.get("Extra Line", "")
        size = soft_copy_data.get("Size", "")
        accreditation = soft_copy_data.get("Accreditation", "")
        logo = soft_copy_data.get("Logo", "")
        # ✅ ADDED: Extract Country field
        country = soft_copy_data.get("Country", "")
        # ✅ ADDED: Extract Address alignment field
        print(f"🔍 [SOFTCOPY-DEBUG] All Excel keys: {list(soft_copy_data.keys())}")
        address_alignment = soft_copy_data.get("Address alignment", "")
        print(f"🔍 [SOFTCOPY-DEBUG] Raw Address alignment from Excel: '{address_alignment}'")
        # Try alternative field names
        alt_address_alignment = soft_copy_data.get("Address Alignment", "")
        print(f"🔍 [SOFTCOPY-DEBUG] Alternative 'Address Alignment': '{alt_address_alignment}'")
        alt_address_alignment2 = soft_copy_data.get("address alignment", "")
        print(f"🔍 [SOFTCOPY-DEBUG] Alternative 'address alignment': '{alt_address_alignment2}'")
        # ✅ ADDED: Extract Language field (S or blank)
        language = soft_copy_data.get("Language", "").strip().lower()

        # ✅ ADDED: Extract logo files from form data
        try:
            form_data = await request.form()
            logo_files = form_data.getlist("logo_files") if hasattr(form_data, 'getlist') else []
            print(f"🔍 [SOFTCOPY] Received {len(logo_files)} logo files")
            
            # ✅ ADDED: Create logo lookup dictionary
            logo_lookup = {}
            for logo_file in logo_files:
                if hasattr(logo_file, 'filename') and logo_file.filename:
                    logo_lookup[logo_file.filename] = logo_file
                    print(f"🔍 [SOFTCOPY] Logo file: {logo_file.filename} ({len(logo_file.file.read()) if hasattr(logo_file.file, 'read') else 'unknown'} bytes)")
                    # Reset file pointer for later use
                    if hasattr(logo_file.file, 'seek'):
                        logo_file.file.seek(0)
        except Exception as logo_error:
            print(f"⚠️ [SOFTCOPY] Error extracting logo files: {logo_error}")
            logo_lookup = {}

        # Validate required fields
        if not company_name:
            raise HTTPException(status_code=400, detail="Company name is required")

        # Prepare values for soft copy generation
        # Map to the exact field names expected by generate_softcopy function
        values = {
            "Company Name": company_name if company_name else "Company Name",
            "Address": address if address else "Address", 
            "ISO Standard": iso_standard if iso_standard else "ISO Standard",
            "Scope": scope if scope else "Scope",
            "Certificate Number": certificate_number if certificate_number else f"SOFT-{company_name[:3].upper()}-{os.getpid()}",
            "Original Issue Date": original_issue_date if original_issue_date else "",
            "Issue Date": issue_date if issue_date else "",
            "Surveillance/ Expiry Date": surveillance_date if surveillance_date else "",
            "Recertification Date": recertification_date if recertification_date else "",
            "Revision": revision if revision else "",
            # ✅ ADDED: Add Size and Accreditation fields
            "Size": size if size else "",
            "Accreditation": accreditation if accreditation else "",
            # ✅ ADDED: Add Country field
            "Country": country if country else "",
            # ✅ ADDED: Add the 3 new optional fields
            "Initial Registration Date": initial_registration_date if initial_registration_date else "",
            "Surveillance Due Date": surveillance_due_date if surveillance_due_date else "",
            "Expiry Date": expiry_date if expiry_date else "",
            # ✅ ADDED: Add Address alignment field
            "Address alignment": address_alignment if address_alignment else "",
            # ✅ ADDED: Add Language field (S or blank)
            "Language": language if language else "",
            # ✅ FIXED: Add Extra Line field to values dictionary for template selection
            "Extra Line": extra_line if extra_line else "",
            # ✅ ADDED: Add logo lookup for filename matching
            "logo_lookup": logo_lookup
        }
        
        # ✅ ADDED: Create field_data for consistency with certificate section
        field_data = values.copy()
        
        # ✅ ADDED: Add optional fields to field_data for the generation function
        field_data["Initial Registration Date"] = initial_registration_date
        field_data["Surveillance Due Date"] = surveillance_due_date
        field_data["Expiry Date"] = expiry_date
        field_data["Certificate Number"] = certificate_number
        field_data["Original Issue Date"] = original_issue_date
        field_data["Issue Date"] = issue_date
        field_data["Surveillance/ Expiry Date"] = surveillance_date
        field_data["Recertification Date"] = recertification_date
        # ✅ ADDED: Add Extra Line field to field data
        field_data["Extra Line"] = extra_line
        # ✅ ADDED: Add Language field to field data
        field_data["Language"] = language
        
        
        # Determine template path and type
        if template:
            # Use uploaded custom template
            import tempfile
            template_path = os.path.join(tempfile.gettempdir(), f"uploaded_template_{template.filename}")
            with open(template_path, "wb") as buffer:
                content = await template.read()
                buffer.write(content)
            template_type = "standard"
            template_name = f"custom_{template.filename}"
        else:
            # Determine which Supabase template to use based on content length and Size/Accreditation
            # Use the SAME LOGIC as certificate generation
            scope_words = len(scope.split()) if scope else 0
            estimated_lines = max(1, (scope_words * 8) // 60)  # 8 chars per word, 60 chars per line
            
            # Get Size, Accreditation, Logo, and Country from the form data
            size = values.get("Size", "").lower().strip()
            accreditation = values.get("Accreditation", "").lower().strip()
            logo = values.get("Logo", "").lower().strip()
            country = values.get("Country", "").strip()  # ✅ ADDED: Country parameter
            
            # ✅ NEW: Check for Extra Line presence FIRST (highest priority)
            extra_line = values.get("Extra Line", "").strip()
            
            # ✅ NEW: Template Override Logic - Extra Line forces large template
            if extra_line:
                print(f"🔍 [SOFTCOPY] Extra Line present - forcing large template selection")
                
                # Force large template based on other parameters
                if country.lower() == "other":
                    if logo and logo.strip() and logo in logo_lookup:
                        # Logo templates for Other country
                        if accreditation == "no":
                            template_name = "templateSoftCopyLogoOtherNonAcc"
                            template_type = "logo_other_nonaccredited"
                        else:
                            template_name = "templateSoftCopyLogoOther"
                            template_type = "logo_other"
                    elif accreditation == "no":
                        template_name = "templateSoftCopyLargeNonAccOther"
                        template_type = "large_nonaccredited_other"
                    elif size == "high":
                        template_name = "template_softCopy_large_other"
                        template_type = "large_other"
                    else:
                        template_name = "template_softCopy_large_other_eco"
                        template_type = "large_other_eco"
                else:  # Default country
                    if logo and logo.strip() and logo in logo_lookup:
                        # Logo templates for Default country
                        if accreditation == "no":
                            template_name = "templateSoftCopyLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templateSoftCopyLogo"
                            template_type = "logo"
                    elif accreditation == "no":
                        template_name = "templateSoftCopyLargeNonAcc"
                        template_type = "large_nonaccredited"
                    elif size == "high":
                        template_name = "template_SoftCopy_large"
                        template_type = "large"
                    else:
                        template_name = "templateSoftCopyLargeEco"
                        template_type = "large_eco"
                
                print(f"🔍 [SOFTCOPY] Extra Line override: {template_name} ({template_type})")
                
            else:
                # ✅ EXISTING: Normal template selection logic
                # ✅ UPDATED: Template selection logic with Country parameter (simplified - no separate logo templates)
                if country.lower() == "other":
                    # Country = "Other" template logic
                    if logo and logo.strip() and logo in logo_lookup:
                        # Logo templates for Other country
                        if accreditation == "no":
                            template_name = "templateSoftCopyLogoOtherNonAcc"
                            template_type = "logo_other_nonaccredited"
                        else:
                            template_name = "templateSoftCopyLogoOther"
                            template_type = "logo_other"
                    elif accreditation == "no":
                        # Non-accredited templates for Other country
                        if estimated_lines <= 11:
                            template_name = "templateSoftCopyStandardNonAccOther"
                            template_type = "standard_nonaccredited_other"
                        else:
                            template_name = "templateSoftCopyLargeNonAccOther"
                            template_type = "large_nonaccredited_other"
                    elif size == "high" and accreditation != "no":
                        # High size with accreditation for Other country
                        if estimated_lines <= 11:
                            template_name = "template_softCopy_other"
                            template_type = "standard_other"
                        else:
                            template_name = "template_softCopy_large_other"
                            template_type = "large_other"
                    else:
                        # Size is blank/low and accreditation != no for Other country - use eco templates
                        if estimated_lines <= 11:
                            template_name = "template_softCopy_other_eco"
                            template_type = "standard_other_eco"
                        else:
                            template_name = "template_softCopy_large_other_eco"
                            template_type = "large_other_eco"
                else:
                    # ✅ ADDED: Logo handling logic (applies to both blank and Other country)
                    if logo and logo.strip() and logo in logo_lookup:
                        # Logo templates take priority - single template regardless of content length
                        if accreditation == "no":
                            template_name = "templateSoftCopyLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templateSoftCopyLogo"
                            template_type = "logo"
                        print(f"🔍 [SOFTCOPY] Logo file found: {logo} - using logo template")
                    elif logo and logo.strip() and logo not in logo_lookup:
                        print(f"⚠️ [SOFTCOPY] Logo specified but file not found: {logo} - using regular template")
                    elif accreditation == "no":
                        # Non-accredited templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templateSoftCopyStandardNonAcc"
                            template_type = "standard_nonaccredited"
                        else:  # Large template for >11 lines
                            template_name = "templateSoftCopyLargeNonAcc"
                            template_type = "large_nonaccredited"
                    elif size == "high" and accreditation != "no":
                        # High size with accreditation - use current templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "template_softCopy"
                            template_type = "standard"
                        else:  # Large template for >11 lines
                            template_name = "template_SoftCopy_large"
                            template_type = "large"
                    else:
                        # Size is blank/low and accreditation != no - use eco templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templateSoftCopyStandardEco"
                            template_type = "standard_eco"
                        else:  # Large template for >11 lines
                            template_name = "templateSoftCopyLargeEco"
                            template_type = "large_eco"
            
            # ✅ ADDED: Apply Language S prefix logic AFTER template selection
            if language == "s":
                template_name = f"S_{template_name}"
                print(f"🔍 [SOFTCOPY] Language: Spanish (S) - using template: {template_name}")
            else:
                print(f"🔍 [SOFTCOPY] Language: English (default) - using template: {template_name}")
            
            # Download template from Supabase storage
            try:
                template_path = await download_template_from_supabase(template_name)
            except Exception as template_error:
                raise HTTPException(status_code=500, detail=f"Template download failed: {str(template_error)}")

        # Generate output filename with proper sanitization
        def sanitize_filename(filename):
            """Sanitize filename by removing/replacing invalid characters"""
            import re
            # Remove or replace invalid filename characters
            # Windows: < > : " | ? * \ /
            # Unix: / (forward slash)
            # Common: \r \n \t (line breaks, tabs)
            sanitized = re.sub(r'[<>:"|?*\\/\r\n\t]', '_', filename)
            # Replace multiple underscores with single underscore
            sanitized = re.sub(r'_+', '_', sanitized)
            # Remove leading/trailing underscores
            sanitized = sanitized.strip('_')
            # Ensure filename is not empty
            if not sanitized:
                sanitized = "company"
            return sanitized
        
        clean_company_name = sanitize_filename(company_name)
        output_filename = f"{clean_company_name}_softcopy.pdf"
        # Use Windows-compatible temporary directory
        import tempfile
        output_path = os.path.join(tempfile.gettempdir(), output_filename)

        # Generate the soft copy using the dedicated soft copy generation function
        
        # Use the dedicated soft copy generation function
        try:
            from rise.generate_softCopy import generate_softcopy
            
            # Call the unified generate_softcopy function with softcopy mode
            result = generate_softcopy(template_path, output_path, field_data, template_type, "softcopy")
            
            # Check for overflow warnings
            if result.get("overflow_warnings"):
                pass  # Overflow warnings are handled in response headers
            
        except Exception as gen_error:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(gen_error)}")

        # Read the generated PDF
        try:
            with open(output_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()
        except Exception as read_error:
            raise HTTPException(status_code=500, detail=f"PDF read failed: {str(read_error)}")

        # Clean up temporary files AFTER reading the content
        if template and os.path.exists(template_path):
            os.unlink(template_path)
        elif not template and os.path.exists(template_path):
            os.unlink(template_path)
        
        # Clean up output file after reading
        if os.path.exists(output_path):
            os.unlink(output_path)

        # Check if we have overflow warnings to include in response headers
        warning_headers = {}
        if 'result' in locals() and result.get("overflow_warnings"):
            warning_messages = [w["message"] for w in result["overflow_warnings"]]
            warning_header = " | ".join(warning_messages)
            warning_headers["X-Overflow-Warnings"] = warning_header
        
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={output_filename}",
                **warning_headers
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate soft copy: {str(e)}")

@app.post("/generate-printable")
async def generate_printable(
    request: Request,
    company_name: str = Form(...),
    address: str = Form(""),
    iso_standard: str = Form(""),
    scope: str = Form(""),
    certificate_number: str = Form(""),
    original_issue_date: str = Form(""),
    issue_date: str = Form(""),
    surveillance_date: str = Form(""),
    recertification_date: str = Form(""),
    revision: str = Form(""),
    size: str = Form(""),
    accreditation: str = Form(""),
    # ✅ ADDED: Country field for template selection
    country: str = Form(""),
    # ✅ ADDED: Extract the 3 new optional fields
    initial_registration_date: str = Form(""),
    surveillance_due_date: str = Form(""),
    expiry_date: str = Form(""),
    # ✅ ADDED: Extract Extra Line field
    extra_line: str = Form(""),
    # ✅ ADDED: Extract Address alignment field
    address_alignment: str = Form(""),
    logo: str = Form(""),
    template: UploadFile = File(None)
):
    """Generate printable certificate from form data."""
    try:
        print(f"🔍 [PRINTABLE] Using individual form parameters")

        # Validate required fields
        if not company_name:
            raise HTTPException(status_code=400, detail="Company name is required")

        # ✅ ADDED: Extract logo files from form data
        try:
            form_data = await request.form()
            logo_files = form_data.getlist("logo_files") if hasattr(form_data, 'getlist') else []
            print(f"🔍 [PRINTABLE] Received {len(logo_files)} logo files")
            
            # ✅ ADDED: Create logo lookup dictionary
            logo_lookup = {}
            for logo_file in logo_files:
                if hasattr(logo_file, 'filename') and logo_file.filename:
                    logo_lookup[logo_file.filename] = logo_file
                    print(f"🔍 [PRINTABLE] Logo file: {logo_file.filename} ({len(logo_file.file.read()) if hasattr(logo_file.file, 'read') else 'unknown'} bytes)")
                    # Reset file pointer for later use
                    if hasattr(logo_file.file, 'seek'):
                        logo_file.file.seek(0)
        except Exception as logo_error:
            print(f"⚠️ [PRINTABLE] Error extracting logo files: {logo_error}")
            logo_lookup = {}

        # Prepare values for printable generation
        # Map to the exact field names expected by generate_printable function
        values = {
            "Company Name": company_name if company_name else "Company Name",
            "Address": address if address else "Address", 
            "ISO Standard": iso_standard if iso_standard else "ISO Standard",
            "Scope": scope if scope else "Scope",
            "Certificate Number": certificate_number if certificate_number else f"PRINT-{company_name[:3].upper()}-{os.getpid()}",
            "Original Issue Date": original_issue_date if original_issue_date else "",
            "Issue Date": issue_date if issue_date else "",
            "Surveillance/ Expiry Date": surveillance_date if surveillance_date else "",
            "Recertification Date": recertification_date if recertification_date else "",
            "Revision": revision if revision else "",
            "Size": size if size else "",
            "Accreditation": accreditation if accreditation else "",
            # ✅ ADDED: Country field for template selection
            "Country": country if country else "",
            # ✅ ADDED: Add the 3 new optional fields
            "Initial Registration Date": initial_registration_date if initial_registration_date else "",
            "Surveillance Due Date": surveillance_due_date if surveillance_due_date else "",
            "Expiry Date": expiry_date if expiry_date else "",
            # ✅ ADDED: Add Extra Line field
            "Extra Line": extra_line if extra_line else "",
            # ✅ ADDED: Add Address alignment field
            "Address alignment": address_alignment if address_alignment else "",
            # ✅ ADDED: Add logo lookup for filename matching
            "logo_lookup": logo_lookup
        }
        
        # ✅ ADDED: Create field_data for consistency with certificate section
        field_data = values.copy()
        
        # ✅ ADDED: Add optional fields to field_data for the generation function
        field_data["Initial Registration Date"] = initial_registration_date
        field_data["Surveillance Due Date"] = surveillance_due_date
        field_data["Expiry Date"] = expiry_date
        field_data["Certificate Number"] = certificate_number
        field_data["Original Issue Date"] = original_issue_date
        field_data["Issue Date"] = issue_date
        field_data["Surveillance/ Expiry Date"] = surveillance_date
        field_data["Recertification Date"] = recertification_date
        # ✅ ADDED: Add Extra Line field to field data
        field_data["Extra Line"] = extra_line
        print(f"🔍 [PRINTABLE] Extra Line received: '{extra_line}'")
        print(f"🔍 [PRINTABLE] Extra Line length: {len(extra_line)}")
        print(f"🔍 [PRINTABLE] Extra Line in field_data: '{field_data.get('Extra Line', 'NOT_FOUND')}'")
        print(f"🔍 [PRINTABLE] Added optional fields to field data")
        
        # Determine template path and type
        if template:
            # Use uploaded custom template
            import tempfile
            template_path = os.path.join(tempfile.gettempdir(), f"uploaded_template_{template.filename}")
            with open(template_path, "wb") as buffer:
                content = await template.read()
                buffer.write(content)
            template_type = "standard"
            template_name = f"custom_{template.filename}"
            print(f"🔍 [PRINTABLE] Using uploaded custom template: {template.filename}")
        else:
            # Determine which Supabase template to use based on content length and Size/Accreditation
            # Use the SAME LOGIC as certificate generation and soft copy
            scope_words = len(scope.split()) if scope else 0
            estimated_lines = max(1, (scope_words * 8) // 60)  # 8 chars per word, 60 chars per line
            
            # Get Size, Accreditation, Logo, and Country from the form data
            size_lower = size.lower().strip() if size else ""
            accreditation_lower = accreditation.lower().strip() if accreditation else ""
            logo_lower = logo.lower().strip() if logo else ""
            country_lower = country.lower().strip() if country else ""  # ✅ ADDED: Country parameter
            
            # ✅ NEW: Check for Extra Line presence FIRST (highest priority)
            extra_line = values.get("Extra Line", "").strip()
            
            # ✅ NEW: Template Override Logic - Extra Line forces large template
            if extra_line:
                print(f"🔍 [PRINTABLE] Extra Line present - forcing large template selection")
                
                # Force large template based on other parameters
                if country_lower == "other":
                    if logo_lower and logo_lower.strip() and logo_lower in logo_lookup:
                        # Logo templates for Other country
                        if accreditation_lower == "no":
                            template_name = "templatePrintableLogoOtherNonAcc"
                            template_type = "logo_other_nonaccredited"
                        else:
                            template_name = "templatePrintableLogoOther"
                            template_type = "logo_other"
                    elif accreditation_lower == "no":
                        template_name = "templateprintableLargeOtherNonAcc"
                        template_type = "large_other_nonaccredited"
                    elif size_lower == "high":
                        template_name = "templateprintableLargeOther"
                        template_type = "large_other"
                    else:
                        template_name = "templateprintableLargeOtherEco"
                        template_type = "large_other_eco"
                else:  # Default country
                    if logo_lower and logo_lower.strip() and logo_lower in logo_lookup:
                        # Logo templates for Default country
                        if accreditation_lower == "no":
                            template_name = "templatePrintableLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templatePrintableLogo"
                            template_type = "logo"
                    elif accreditation_lower == "no":
                        template_name = "templateprintableLargeNonAcc"
                        template_type = "large_nonaccredited"
                    elif size_lower == "high":
                        template_name = "templateprintableLarge"
                        template_type = "large"
                    else:
                        template_name = "templateprintableLargeEco"
                        template_type = "large_eco"
                
                print(f"🔍 [PRINTABLE] Extra Line override: {template_name} ({template_type})")
                
            else:
                # ✅ EXISTING: Normal template selection logic
                # ✅ UPDATED: Template selection logic with correct template names
                if country_lower == "other":
                    # Country = "Other" template logic
                    if logo_lower and logo_lower.strip() and logo_lower in logo_lookup:
                        # Logo templates for Other country
                        if accreditation_lower == "no":
                            template_name = "templatePrintableLogoOtherNonAcc"
                            template_type = "logo_other_nonaccredited"
                        else:
                            template_name = "templatePrintableLogoOther"
                            template_type = "logo_other"
                    elif accreditation_lower == "no":
                        # Non-accredited templates for Other country
                        if estimated_lines <= 11:
                            template_name = "templatePrintableOtherNonAcc"
                            template_type = "standard_other_nonaccredited"
                        else:
                            template_name = "templateprintableLargeOtherNonAcc"
                            template_type = "large_other_nonaccredited"
                    elif size_lower == "high" and accreditation_lower != "no":
                        # High size with accreditation for Other country
                        if estimated_lines <= 11:
                            template_name = "templatePrintableStandardOther"
                            template_type = "standard_other"
                        else:
                            template_name = "templateprintableLargeOther"
                            template_type = "large_other"
                    else:
                        # Size is blank/low and accreditation != no for Other country - use eco templates
                        if estimated_lines <= 11:
                            template_name = "templatePrintableStandardOtherEco"
                            template_type = "standard_other_eco"
                        else:
                            template_name = "templateprintableLargeOtherEco"
                            template_type = "large_other_eco"
                else:
                    # Original template logic for blank country
                    if logo_lower and logo_lower.strip() and logo_lower in logo_lookup:
                        # Logo templates take priority - single template regardless of content length
                        if accreditation_lower == "no":
                            template_name = "templatePrintableLogoNonAcc"
                            template_type = "logo_nonaccredited"
                        else:
                            template_name = "templatePrintableLogo"
                            template_type = "logo"
                    elif logo_lower and logo_lower.strip() and logo_lower not in logo_lookup:
                        print(f"⚠️ [PRINTABLE] Logo specified but file not found: {logo_lower} - using regular template")
                        # Continue with regular template selection logic
                    elif accreditation_lower == "no":
                        # Non-accredited templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templatePrintableStandardNonAcc"
                            template_type = "standard_nonaccredited"
                        else:  # Large template for >11 lines
                            template_name = "templateprintableLargeNonAcc"
                            template_type = "large_nonaccredited"
                    elif size_lower == "high" and accreditation_lower != "no":
                        # High size with accreditation - use current templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templatePrintableStandard"
                            template_type = "standard"
                        else:  # Large template for >11 lines
                            template_name = "templateprintableLarge"
                            template_type = "large"
                    else:
                        # Size is blank/low and accreditation != no - use eco templates
                        if estimated_lines <= 11:  # Standard template for ≤11 lines
                            template_name = "templatePrintableStandardEco"
                            template_type = "standard_eco"
                        else:  # Large template for >11 lines
                            template_name = "templateprintableLargeEco"
                            template_type = "large_eco"
            
            print(f"🔍 [PRINTABLE] Scope: {scope_words} words, ~{estimated_lines} lines, Size: '{size_lower}', Accreditation: '{accreditation_lower}', Logo: '{logo_lower}', Country: '{country_lower}', using {template_type} template: {template_name}.pdf")
            
            # Download template from Supabase storage
            print(f"🔍 [PRINTABLE] Downloading {template_name}.pdf from Supabase...")
            try:
                template_path = await download_template_from_supabase(template_name)
                print(f"🔍 [PRINTABLE] Template downloaded to: {template_path}")
            except Exception as template_error:
                print(f"❌ [PRINTABLE] Template download failed: {template_error}")
                raise HTTPException(status_code=500, detail=f"Template download failed: {str(template_error)}")

        # Generate output filename with proper sanitization
        def sanitize_filename(filename):
            """Sanitize filename by removing/replacing invalid characters"""
            import re
            # Remove or replace invalid filename characters
            # Windows: < > : " | ? * \ /
            # Unix: / (forward slash)
            # Common: \r \n \t (line breaks, tabs)
            sanitized = re.sub(r'[<>:"|?*\\/\r\n\t]', '_', filename)
            # Replace multiple underscores with single underscore
            sanitized = re.sub(r'_+', '_', sanitized)
            # Remove leading/trailing underscores
            sanitized = sanitized.strip('_')
            # Ensure filename is not empty
            if not sanitized:
                sanitized = "company"
            return sanitized
        
        clean_company_name = sanitize_filename(company_name)
        output_filename = f"{clean_company_name}_printable.pdf"
        # Use Windows-compatible temporary directory
        import tempfile
        output_path = os.path.join(tempfile.gettempdir(), output_filename)

        # Generate the printable using the dedicated printable generation function
        print(f"🔍 [PRINTABLE] Starting printable generation with {template_type} template...")
        
        # Use the unified PDF generation function with printable mode
        try:
            from rise.generate_softCopy import generate_softcopy
            print(f"🔍 [PRINTABLE] Calling unified generate_softcopy with template: {template_path}")
            print(f"🔍 [PRINTABLE] Output path: {output_path}")
            result = generate_softcopy(template_path, output_path, field_data, template_type, "printable")
            print(f"🔍 [PRINTABLE] PDF generation completed successfully")
            # Check for overflow warnings
            if result.get("overflow_warnings"):
                print(f"⚠️ [PRINTABLE] Overflow warnings: {result['overflow_warnings']}")
        except Exception as gen_error:
            print(f"❌ [PRINTABLE] PDF generation failed: {gen_error}")
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(gen_error)}")

        # Read the generated PDF
        try:
            print(f"🔍 [PRINTABLE] Reading generated PDF from: {output_path}")
            with open(output_path, "rb") as pdf_file:
                pdf_content = pdf_file.read()
            print(f"🔍 [PRINTABLE] PDF read successfully, size: {len(pdf_content)} bytes")
            
            # Validate PDF content
            if len(pdf_content) == 0:
                raise ValueError("Generated PDF is empty (0 bytes)")
            
            # Check if content starts with PDF header
            if not pdf_content.startswith(b'%PDF'):
                raise ValueError("Generated file does not appear to be a valid PDF")
                
        except Exception as read_error:
            print(f"❌ [PRINTABLE] PDF read failed: {read_error}")
            raise HTTPException(status_code=500, detail=f"PDF read failed: {str(read_error)}")

        # Clean up temporary files AFTER reading the content
        try:
            if template and os.path.exists(template_path):
                os.unlink(template_path)
                print(f"🔍 [PRINTABLE] Template file cleaned up: {template_path}")
            elif not template and os.path.exists(template_path):
                os.unlink(template_path)
                print(f"🔍 [PRINTABLE] Template file cleaned up: {template_path}")
        except Exception as cleanup_error:
            print(f"⚠️ [PRINTABLE] Template cleanup warning: {cleanup_error}")
        
        # Clean up output file after reading (but before response)
        try:
            if os.path.exists(output_path):
                os.unlink(output_path)
                print(f"🔍 [PRINTABLE] Output file cleaned up: {output_path}")
        except Exception as cleanup_error:
            print(f"⚠️ [PRINTABLE] Output file cleanup warning: {cleanup_error}")

        # Set proper response headers for PDF download
        response_headers = {
            "Content-Disposition": f"attachment; filename={output_filename}",
            "Content-Type": "application/pdf",
            "Content-Length": str(len(pdf_content)),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
        
        print(f"🔍 [PRINTABLE] Returning PDF response: {len(pdf_content)} bytes, filename: {output_filename}")
        
        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers=response_headers
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate printable: {str(e)}")

# New endpoint: Generate certificate from JSON data (no Word file required)
@app.post("/generate-certificate-json")
async def generate_certificate_json_endpoint(
    request: Request,
    fields: str = Form(...)
):
    """Generate certificate from JSON field data using Supabase template (no Word file required)."""
    try:
        # Parse field data
        if not fields or fields.strip() == "":
            raise HTTPException(status_code=400, detail="Field data is empty or missing")
        
        try:
            field_data = json.loads(fields)
            if field_data is None:
                raise HTTPException(status_code=400, detail="Field data is null")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid field data format")
        
        # Extract logo files from form data
        logo_lookup = {}
        try:
            form_data = await request.form()
            logo_files = form_data.getlist("logo_files") if hasattr(form_data, 'getlist') else []
            
            # Create logo lookup dictionary
            for logo_file in logo_files:
                if hasattr(logo_file, 'filename') and logo_file.filename:
                    logo_lookup[logo_file.filename] = logo_file
        except Exception as logo_error:
            print(f"⚠️ [CERTIFICATE-JSON] Error extracting logo files: {logo_error}")
            logo_lookup = {}
        
        # Extract all the same fields as the original endpoint
        initial_registration_date = field_data.get("Initial Registration Date", "")
        surveillance_due_date = field_data.get("Surveillance Due Date", "")
        expiry_date = field_data.get("Expiry Date", "")
        certificate_number = field_data.get("Certificate Number", "")
        original_issue_date = field_data.get("Original Issue Date", "")
        issue_date = field_data.get("Issue Date", "")
        surveillance_date = field_data.get("Surveillance/ Expiry Date", "")
        recertification_date = field_data.get("Recertification Date", "")
        extra_line = field_data.get("Extra Line", "")
        # ✅ ADDED: Extract Address alignment field
        address_alignment = field_data.get("Address alignment", "")
        
        # Create output file path
        output_filename = f"generated_certificate_{os.getpid()}.pdf"
        output_path = os.path.join(tempfile.gettempdir(), output_filename)
        
        # Use the same template selection logic as the original endpoint
        scope_text = field_data.get("Scope", "")
        scope_words = len(scope_text.split())
        raw_size = field_data.get("Size", "")
        size = raw_size.lower().strip()
        accreditation = field_data.get("Accreditation", "").lower().strip()
        logo = field_data.get("Logo", "").lower().strip()
        country = field_data.get("Country", "").strip()
        estimated_lines = max(1, (scope_words * 8) // 60)
        logo_filename = field_data.get("Logo", "").strip()
        
        # Template selection logic (same as original endpoint)
        if extra_line:
            print(f"🔍 [CERTIFICATE-JSON] Extra Line present - forcing large template selection")
            
            # Force large template based on other parameters
            if country.lower() == "other":
                if accreditation == "no":
                    template_name = "templateDraftLargeNonAccOther"
                    template_type = "large_nonaccredited_other"
                elif size == "high":
                    template_name = "template_draft_large_other"
                    template_type = "large_other"
                else:
                    template_name = "template_draft_large_other_eco"
                    template_type = "large_other_eco"
            else:  # Default country
                if logo_filename and logo_filename in logo_lookup:
                    template_name = "templateDraftLogo"
                    template_type = "logo"
                elif accreditation == "no":
                    template_name = "templateDraftLargeNonAcc"
                    template_type = "large_nonaccredited"
                elif size == "high":
                    template_name = "template_draft_large"
                    template_type = "large"
                else:
                    template_name = "templateDraftLargeEco"
                    template_type = "large_eco"
            
            print(f"🔍 [CERTIFICATE-JSON] Extra Line override: {template_name} ({template_type})")
        else:
            # Regular template selection logic (same as main endpoint)
            if country.lower() == "other":
                if accreditation == "no":
                    # Non-accredited templates for Other country
                    if estimated_lines <= 11:
                        template_name = "templateDraftStandardNonAccOther"
                        template_type = "standard_nonaccredited_other"
                    else:
                        template_name = "templateDraftLargeNonAccOther"
                        template_type = "large_nonaccredited_other"
                elif size == "high" and accreditation != "no":
                    # High size with accreditation for Other country
                    if estimated_lines <= 11:
                        template_name = "template_draft_other"
                        template_type = "standard_other"
                    else:
                        template_name = "template_draft_large_other"
                        template_type = "large_other"
                else:
                    # Size is blank/low and accreditation != no for Other country - use eco templates
                    if estimated_lines <= 11:
                        template_name = "template_draft_other_eco"
                        template_type = "standard_other_eco"
                    else:
                        template_name = "template_draft_large_other_eco"
                        template_type = "large_other_eco"
            else:
                # Logo handling logic (applies to both blank and Other country)
                if logo_filename and logo_filename in logo_lookup:
                    # Logo templates take priority - single template regardless of content length
                    template_name = "templateDraftLogo"
                    template_type = "logo"
                elif logo_filename and logo_filename not in logo_lookup:
                    print(f"⚠️ [CERTIFICATE-JSON] Logo specified but file not found: {logo_filename} - using regular template")
                    # Continue with regular template selection logic
                elif accreditation == "no":
                    # Non-accredited templates
                    if estimated_lines <= 11:  # Standard template for ≤11 lines
                        template_name = "templateDraftStandardNonAcc"
                        template_type = "standard_nonaccredited"
                    else:  # Large template for >11 lines
                        template_name = "templateDraftLargeNonAcc"
                        template_type = "large_nonaccredited"
                elif size == "high" and accreditation != "no":
                    # High size with accreditation - use current templates
                    if estimated_lines <= 11:  # Standard template for ≤11 lines
                        template_name = "template_draft"
                        template_type = "standard"
                    else:  # Large template for >11 lines
                        template_name = "template_draft_large"
                        template_type = "large"
                else:
                    # Size is blank/low and accreditation != no - use eco templates
                    if estimated_lines <= 11:  # Standard template for ≤11 lines
                        template_name = "templateDraftStandardEco"
                        template_type = "standard_eco"
                    else:  # Large template for >11 lines
                        template_name = "templateDraftLargeEco"
                        template_type = "large_eco"
        
        # Download template from Supabase
        template_path = await download_template_from_supabase(template_name)
        
        # Prepare values for certificate generation
        values = field_data.copy()
        values["logo_lookup"] = logo_lookup
        
        # Generate certificate using the same function
        result = generate_certificate(template_path, output_path, values, template_type)
        
        # Check for overflow warnings
        if result.get("overflow_warnings"):
            print(f"[CERTIFICATE-JSON] ===== OVERFLOW WARNINGS =====")
            for warning in result["overflow_warnings"]:
                print(f"[CERTIFICATE-JSON] {warning['message']}")
            print(f"[CERTIFICATE-JSON] ===== END OVERFLOW WARNINGS =====")
        
        # Read the generated PDF
        with open(output_path, "rb") as f:
            pdf_bytes = f.read()
        
        # Clean up temporary files
        if os.path.exists(output_path):
            os.unlink(output_path)
        if os.path.exists(template_path):
            os.unlink(template_path)
        
        # Return PDF response
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=certificate_{certificate_number or 'generated'}.pdf"
            }
        )
        
    except Exception as e:
        # Clean up temporary files on error
        if 'output_path' in locals() and os.path.exists(output_path):
            os.unlink(output_path)
        if 'template_path' in locals() and os.path.exists(template_path):
            os.unlink(template_path)
        raise HTTPException(status_code=500, detail=f"Certificate generation failed: {str(e)}")

# Soft copy generation endpoint now integrated into main.py

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
