import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract form data
    const company_name = formData.get('company_name') as string;
    const address = formData.get('address') as string;
    const address_alignment = formData.get('address_alignment') as string;  // ✅ ADDED: Extract address alignment
    const iso_standard = formData.get('iso_standard') as string;
    const scope = formData.get('scope') as string;
    const certificate_number = formData.get('certificate_number') as string;
    const original_issue_date = formData.get('original_issue_date') as string;
    const issue_date = formData.get('issue_date') as string;
    const surveillance_date = formData.get('surveillance_date') as string;
    const recertification_date = formData.get('recertification_date') as string;
    const revision = formData.get('revision') as string;
    const size = formData.get('size') as string;
    const accreditation = formData.get('accreditation') as string;
    // ✅ ADDED: Extract country field for template selection
    const country = formData.get('country') as string;
    // ✅ ADDED: Extract the 3 new optional fields
    const initial_registration_date = formData.get('initial_registration_date') as string;
    const surveillance_due_date = formData.get('surveillance_due_date') as string;
    const expiry_date = formData.get('expiry_date') as string;
    // ✅ ADDED: Extract Extra Line field
    const extra_line = formData.get('extra_line') as string;
    const logo = formData.get('logo') as string;

    // ✅ ADDED: Extract logo files from form data
    const logoFiles = formData.getAll('logo_files') as File[];

    // ✅ ADDED: Create logo lookup dictionary for Python service
    const logoLookup: { [filename: string]: File } = {};
    logoFiles.forEach(file => {
      logoLookup[file.name] = file;
    });

    // Validate required fields
    if (!company_name) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    // Create form data for Python service (using the exact field names expected by the Python service)
    const pythonFormData = new FormData();
    pythonFormData.append('company_name', company_name);
    pythonFormData.append('address', address || '');
    pythonFormData.append('address_alignment', address_alignment || '');  // ✅ ADDED: Send address alignment to Python service
    pythonFormData.append('iso_standard', iso_standard || '');
    pythonFormData.append('scope', scope || '');
    pythonFormData.append('certificate_number', certificate_number || '');
    pythonFormData.append('original_issue_date', original_issue_date || '');
    pythonFormData.append('issue_date', issue_date || '');
    pythonFormData.append('surveillance_date', surveillance_date || '');
    pythonFormData.append('recertification_date', recertification_date || '');
    pythonFormData.append('revision', revision || '');
    pythonFormData.append('size', size || '');
    pythonFormData.append('accreditation', accreditation || '');
    pythonFormData.append('country', country || '');  // ✅ ADDED: Send country to Python service
    pythonFormData.append('initial_registration_date', initial_registration_date || '');
    pythonFormData.append('surveillance_due_date', surveillance_due_date || '');
    pythonFormData.append('expiry_date', expiry_date || '');
    pythonFormData.append('extra_line', extra_line || '');  // ✅ ADDED: Send Extra Line to Python service
    pythonFormData.append('logo', logo || '');

    // Add logo files to the FormData for the Python service
    for (const [filename, file] of Object.entries(logoLookup)) {
      pythonFormData.append('logo_files', file, filename);
    }

    // Call Python service
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
    const response = await fetch(`${pythonServiceUrl}/generate-printable`, {
      method: 'POST',
      body: pythonFormData,
      headers: {
        'x-internal-token': '123',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.detail || 'Failed to generate printable certificate' },
        { status: response.status }
      );
    }

    // Get the PDF blob from the Python service
    const pdfBlob = await response.blob();
    
    // Sanitize filename for Content-Disposition header
    const sanitizeFilename = (filename: string): string => {
      // Remove or replace invalid filename characters
      // Windows: < > : " | ? * \ /
      // Unix: / (forward slash)
      // Common: \r \n \t (line breaks, tabs)
      let sanitized = filename.replace(/[<>:"|?*\\/\r\n\t]/g, '_');
      // Replace multiple underscores with single underscore
      sanitized = sanitized.replace(/_+/g, '_');
      // Remove leading/trailing underscores
      sanitized = sanitized.replace(/^_+|_+$/g, '');
      // Ensure filename is not empty
      if (!sanitized) {
        sanitized = "company";
      }
      return sanitized;
    };
    
    const cleanCompanyName = sanitizeFilename(company_name);
    
    // Return the PDF as a blob
    const responseHeaders = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cleanCompanyName}_printable.pdf"`,
    };
    
    return new NextResponse(pdfBlob, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}
