import { NextRequest, NextResponse } from "next/server";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const formDoc = form.get("form") as File | null;
    const fieldsData = form.get("fields") as string | null;

    // ✅ ADDED: Extract logo files from form data
    const logoFiles = form.getAll("logo_files") as File[];
    console.log(`🔍 [CERTIFICATE] Received ${logoFiles.length} logo files`);

    // ✅ ADDED: Create logo lookup dictionary for Python service
    const logoLookup: { [filename: string]: File } = {};
    logoFiles.forEach(file => {
      logoLookup[file.name] = file;
      console.log(`🔍 [CERTIFICATE] Logo file: ${file.name} (${file.size} bytes)`);
    });

    if (!formDoc) {
      return NextResponse.json(
        { error: "No form document uploaded" },
        { status: 400 }
      );
    }

    if (!fieldsData) {
      return NextResponse.json(
        { error: "No field data provided" },
        { status: 400 }
      );
    }

    const fileExtension = formDoc.name.toLowerCase().split('.').pop();
    const supportedExtensions = ['docx', 'pdf', 'png', 'jpg', 'jpeg'];
    
    if (!fileExtension || !supportedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Form must be .docx, .pdf, .png, or .jpg format" },
        { status: 400 }
      );
    }

    // Parse the field data
    let fields: Record<string, string>;
    try {
      fields = JSON.parse(fieldsData);
    } catch (e) {
      return NextResponse.json(
        { error: "Invalid field data format" },
        { status: 400 }
      );
    }

    // ✅ ADDED: Extract new required fields
    const certificateNumber = fields['Certificate Number'] || '';
    const originalIssueDate = fields['Original Issue Date'] || '';
    const issueDate = fields['Issue Date'] || '';
    const surveillanceExpiryDate = fields['Surveillance/Expiry Date'] || '';
    const recertificationDate = fields['Recertification Date'] || '';
    
    // ✅ ADDED: Extract new optional fields
    const initialRegistrationDate = fields['Initial Registration Date'] || '';
    const surveillanceDueDate = fields['Surveillance Due Date'] || '';
    const expiryDate = fields['Expiry Date'] || '';
    const country = fields['Country'] || '';  // ✅ ADDED: Country field extraction
    
    console.log(`🔍 [CERTIFICATE] Required fields:`, {
      certificateNumber,
      originalIssueDate,
      issueDate,
      surveillanceExpiryDate,
      recertificationDate
    });
    
    console.log(`🔍 [CERTIFICATE] Optional fields:`, {
      initialRegistrationDate,
      surveillanceDueDate,
      expiryDate,
      country  // ✅ ADDED: Country field logging
    });
    
        // ✅ ADDED: Log all received fields for debugging
    console.log(`🔍 [CERTIFICATE] All received fields:`, fields);
    
    // ✅ ADDED: Validate required fields
    const requiredFields = ['Company Name', 'Address', 'Scope', 'ISO Standard'];
    const missingFields = requiredFields.filter(field => !fields[field] || fields[field].trim() === '');
    
    if (missingFields.length > 0) {
      console.error(`🔍 [CERTIFICATE] Missing required fields:`, missingFields);
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }
    
    // ✅ FIXED: Prepare data in the same format as working soft copy route

    // Call Python service to generate certificate
    const pdfServiceUrl = process.env.PDF_SERVICE_URL;
    const internalToken = '123';
    
    console.log(`🔍 [CERTIFICATE] PDF Service URL: ${pdfServiceUrl}`);
    console.log(`🔍 [CERTIFICATE] Internal Token: ${internalToken ? 'Present' : 'Missing'}`);
    
    if (!pdfServiceUrl) {
      console.error("🔍 [CERTIFICATE] PDF_SERVICE_URL environment variable not set");
      return NextResponse.json(
        { error: "PDF service not configured - PDF_SERVICE_URL missing" },
        { status: 500 }
      );
    }
    
    if (!internalToken) {
      console.error("🔍 [CERTIFICATE] INTERNAL_TOKEN environment variable not set");
      return NextResponse.json(
        { error: "PDF service not configured - INTERNAL_TOKEN missing" },
        { status: 500 }
      );
    }

    // ✅ FIXED: Send data in the format Python service expects
    const pythonFormData = new FormData();
    pythonFormData.append('fields', fieldsData); // Send fields as JSON string directly
    pythonFormData.append('form', new Blob([await formDoc.arrayBuffer()]), formDoc.name);
    
    // Add logo files separately
    logoFiles.forEach(file => {
      pythonFormData.append("logo_files", file);
    });

    const endpoint = "/generate-certificate"; // Keep original endpoint
    const fullUrl = `${pdfServiceUrl}${endpoint}`;
    
    console.log(`🔍 [CERTIFICATE] Calling Python service at: ${fullUrl}`);
    console.log(`🔍 [CERTIFICATE] Data being sent:`, {
      fields: JSON.parse(fieldsData),
      form: formDoc.name,
      logo_files: logoFiles.map(f => f.name)
    });
    
    // ✅ ADDED: Debug Country field specifically
    const fieldsObj = JSON.parse(fieldsData);
    console.log(`🔍 [CERTIFICATE] Country field value: '${fieldsObj['Country'] || 'NOT_FOUND'}'`);
    console.log(`🔍 [CERTIFICATE] All field keys:`, Object.keys(fieldsObj));
    
    const response = await fetch(fullUrl, {
      method: "POST",
      body: pythonFormData,
      headers: {
        "x-internal-token": internalToken,
      },
    });
    
    console.log(`🔍 [CERTIFICATE] Python service response:`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = `Failed to read error response: ${e}`;
      }
      
      console.error("PDF service error:", {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      return NextResponse.json(
        { error: `PDF service error (${response.status}): ${errorText}` },
        { status: response.status }
      );
    }

    const pdfBuffer = await response.arrayBuffer();
    
    // Create filename in format: CompanyName_ISOStandard_draft.pdf
    const companyName = fields['Company Name'] || fields['Company'] || 'Unknown';
    const isoStandard = fields['ISO Standard'] || 'Unknown';
    
    // Clean company name and ISO standard for filename - keep non-ASCII but handle HTTP headers
    const cleanCompanyName = companyName
      .replace(/[<>:"/\\|?*]/g, '_')  // Remove invalid filename characters
      .replace(/\s+/g, '_');           // Replace spaces with underscores
    const cleanISOStandard = isoStandard
      .replace(/[<>:"/\\|?*]/g, '_')  // Remove invalid filename characters
      .replace(/\s+/g, '_');           // Replace spaces with underscores
    
    const downloadName = `${cleanCompanyName}_${cleanISOStandard}_draft.pdf`;

    // Create ASCII-safe version for filename attribute (backward compatibility)
    const asciiFilename = downloadName.replace(/[^\x00-\x7F]/g, '_');
    // Encode UTF-8 version for filename* attribute
    const encodedFilename = encodeURIComponent(downloadName);
    
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });

  } catch (error) {
    console.error("Certificate generation API error:", error);
    
    // ✅ ADDED: Better error logging
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
