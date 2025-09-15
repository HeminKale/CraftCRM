import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    console.log('🔍 [CERTIFICATE-JSON] Certificate generation API called');
    
    const formData = await req.formData();
    console.log('🔍 [CERTIFICATE-JSON] FormData received, keys:', Array.from(formData.keys()));
    
    const fields = formData.get("fields") as string | null;
    console.log('🔍 [CERTIFICATE-JSON] Fields received:', fields ? 'Present' : 'Missing');

    if (!fields) {
      return NextResponse.json(
        { error: "Fields data is required" },
        { status: 400 }
      );
    }

    // Forward the request to the Python service
    const pythonServiceUrl = process.env.PDF_SERVICE_URL || 'http://localhost:8000';
    const internalToken = '123';
    
    if (!internalToken) {
      console.error("🔍 [CERTIFICATE-JSON] INTERNAL_TOKEN environment variable not set");
      return NextResponse.json(
        { error: "PDF service not configured - INTERNAL_TOKEN missing" },
        { status: 500 }
      );
    }
    
    const response = await fetch(`${pythonServiceUrl}/generate-certificate-json`, {
      method: 'POST',
      body: formData,
      headers: {
        "x-internal-token": internalToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🔍 [CERTIFICATE-JSON] Python service error:', errorText);
      return NextResponse.json(
        { error: `Python service error: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    // Return the PDF directly
    const pdfBuffer = await response.arrayBuffer();
    
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=certificate.pdf',
      },
    });

  } catch (error) {
    console.error("🔍 [CERTIFICATE-JSON] Certificate generation error:", error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to generate certificate: ${errorMessage}` },
      { status: 500 }
    );
  }
}
