import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const formDoc = form.get("form") as File | null;

    if (!formDoc) {
      return NextResponse.json(
        { error: "No form document uploaded" },
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

    // Prepare form data for Python service
    const fd = new FormData();
    fd.append("form", new Blob([await formDoc.arrayBuffer()]), formDoc.name);

    // Call Python service to extract fields
    const pdfServiceUrl = process.env.PDF_SERVICE_URL;
    if (!pdfServiceUrl) {
      return NextResponse.json(
        { error: "PDF service not configured" },
        { status: 500 }
      );
    }

    const response = await fetch(`${pdfServiceUrl}/extract-fields`, {
      method: "POST",
      body: fd,
      headers: {
        "x-internal-token": "123",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ [API] Python service error:", errorText);
      return NextResponse.json(
        { error: `PDF service error: ${errorText}` },
        { status: response.status }
      );
    }

    const extractedFields = await response.json();
    
    // Transform the Python service response to match frontend interface
    const transformedFields = Object.entries(extractedFields).map(([name, value]) => ({
      name: name,
      value: value as string
    }));
    
    return NextResponse.json({
      success: true,
      fields: transformedFields,
      fileName: formDoc.name,
    });

  } catch (error) {
    console.error("❌ [API] Field extraction API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
