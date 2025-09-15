import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    
    // Extract JSON data from form data
    const dataField = formData.get('data') as string;
    if (!dataField) {
      return NextResponse.json(
        { error: 'Data field is required' },
        { status: 400 }
      );
    }

    let jsonData: any;
    try {
      jsonData = JSON.parse(dataField);
    } catch (parseError) {
      console.error('Failed to parse JSON data:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON data' },
        { status: 400 }
      );
    }

    // Extract logo files from form data
    const logoFiles = formData.getAll('logo_files') as File[];

    // Create logo lookup dictionary for Python service
    const logoLookup: { [filename: string]: File } = {};
    logoFiles.forEach(file => {
      logoLookup[file.name] = file;
    });

    // Validate required fields
    const companyName = jsonData["Company Name"];
    if (!companyName || !companyName.trim()) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    // Prepare data for Python service (using the same format as certificate generation)
    const certificateData = {
      "Company Name": companyName.trim(),
      "Address": jsonData["Address"]?.trim() || '',
      "ISO Standard": jsonData["ISO Standard"]?.trim() || '',
      "Scope": jsonData["Scope"]?.trim() || '',
      "Channel Partner": jsonData["Channel Partner"]?.trim() || '',
      "Type": jsonData["Type"]?.trim() || '',
      "Size": jsonData["Size"]?.trim() || '',
      "Accreditation": jsonData["Accreditation"]?.trim() || '',
      "Logo": jsonData["Logo"]?.trim() || '',
      "Country": jsonData["Country"]?.trim() || '',
      "Certificate Number": jsonData["Certificate Number"]?.trim() || '',
      "Original Issue Date": jsonData["Original Issue Date"]?.trim() || '',
      "Issue Date": jsonData["Issue Date"]?.trim() || '',
      "Surveillance/ Expiry Date": jsonData["Surveillance/ Expiry Date"]?.trim() || '',
      "Recertification Date": jsonData["Recertification Date"]?.trim() || '',
      "Initial Registration Date": jsonData["Initial Registration Date"]?.trim() || '',
      "Surveillance Due Date": jsonData["Surveillance Due Date"]?.trim() || '',
      "Expiry Date": jsonData["Expiry Date"]?.trim() || '',
      "Revision": jsonData["Revision"]?.trim() || '',
      // Pass logo files to Python service
      logo_lookup: logoLookup
    };

    // Call Python service
    const pdfServiceUrl = process.env.PDF_SERVICE_URL;
    const internalToken = '123';
    
    if (!pdfServiceUrl) {
      return NextResponse.json(
        { error: 'PDF service not configured' },
        { status: 500 }
      );
    }
    
    if (!internalToken) {
      return NextResponse.json(
        { error: 'Internal token not configured' },
        { status: 500 }
      );
    }
    
    // Create form data for Python service
    const pythonFormData = new FormData();
    pythonFormData.append('data', JSON.stringify(certificateData));

    // Add logo files separately
    logoFiles.forEach(file => {
      pythonFormData.append("logo_files", file);
    });

    const response = await fetch(`${pdfServiceUrl}/generate-certificate`, {
      method: 'POST',
      body: pythonFormData,
      headers: {
        "x-internal-token": internalToken,
      },
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
        errorText: errorText
      });
      
      return NextResponse.json(
        { error: `PDF service error (${response.status}): ${errorText}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        output_path: result.output_path,
        template_type: result.template_type,
        overflow_warnings: result.overflow_warnings || []
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to generate certificate'
      }, { status: 500 });
    }

  } catch (error) {
    console.error("Client draft generation API error:", error);
    
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
