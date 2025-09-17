import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // ✅ FIXED: Extract JSON data from form data
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

    // ✅ ADDED: Extract logo files from form data
    const logoFiles = formData.getAll('logo_files') as File[];

    // ✅ ADDED: Create logo lookup dictionary for Python service
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

    // Prepare data for Python service
    const softCopyData = {
      // ✅ FIXED: Use data from JSON
      "Company Name": companyName.trim(),
      "Address": jsonData["Address"]?.trim() || '',
      "Address alignment": jsonData["Address alignment"]?.trim() || '',
      "ISO Standard": jsonData["ISO Standard"]?.trim() || '',
      "Scope": jsonData["Scope"]?.trim() || '',
      "Certificate Number": jsonData["Certificate Number"]?.trim() || '',
      "Original Issue Date": jsonData["Original Issue Date"]?.trim() || '',
      "Issue Date": jsonData["Issue Date"]?.trim() || '',
      "Surveillance/ Expiry Date": jsonData["Surveillance/ Expiry Date"]?.trim() || '',
      "Recertification Date": jsonData["Recertification Date"]?.trim() || '',
      "Revision": jsonData["Revision"]?.trim() || '',
      "Initial Registration Date": jsonData["Initial Registration Date"]?.trim() || '',
      "Surveillance Due Date": jsonData["Surveillance Due Date"]?.trim() || '',
      "Expiry Date": jsonData["Expiry Date"]?.trim() || '',
      "Size": jsonData["Size"]?.trim() || '',
      "Accreditation": jsonData["Accreditation"]?.trim() || '',
      "Logo": jsonData["Logo"]?.trim() || '',
      "Country": jsonData["Country"]?.trim() || '',
      "Extra Line": jsonData["Extra Line"]?.trim() || '',
      "Language": jsonData["Language"]?.trim() || '',  // ✅ ADDED: Language field
      // ✅ ADDED: 6 new Excel adjustment fields
      "Name Font Size": jsonData["Name Font Size"]?.trim() || '',
      "Name Adjustment": jsonData["Name Adjustment"]?.trim() || '',
      "Address Font Size": jsonData["Address Font Size"]?.trim() || '',
      "Address Adjustment": jsonData["Address Adjustment"]?.trim() || '',
      "Scope Font Size": jsonData["Scope Font Size"]?.trim() || '',
      "Scope Adjustment": jsonData["Scope Adjustment"]?.trim() || '',
      // ✅ ADDED: Pass logo files to Python service
      logo_lookup: logoLookup
    };

    // Debug logging for Address alignment and Language
    console.log('🔍 [FRONTEND] Address alignment from Excel:', jsonData["Address alignment"]);
    console.log('🔍 [FRONTEND] Address alignment in softCopyData:', softCopyData["Address alignment"]);



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
    pythonFormData.append('data', JSON.stringify(softCopyData));
    
    // ✅ ADDED: Forward logo files to Python service
    logoFiles.forEach(file => {
      pythonFormData.append('logo_files', file);
    });

    const response = await fetch(`${pdfServiceUrl}/generate-softcopy`, {
      method: 'POST',
      body: pythonFormData,
      headers: {
        "x-internal-token": internalToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python service failed: ${response.status} ${response.statusText}`);
    }

    // The Python service returns a PDF file, not JSON
    const pdfBlob = await response.blob();
    
    return new NextResponse(pdfBlob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${companyName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')}_softcopy.pdf"`
      }
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to generate soft copy',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
