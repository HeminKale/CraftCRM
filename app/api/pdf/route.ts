import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    
    // Expect either: (A) Word form + PDF template OR (B) single Word file
    const formDoc = form.get("form") as File | null;
    const template = form.get("template") as File | null;
    const single = form.get("file") as File | null;

    // Validate input
    if (!formDoc && !single) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    // Prepare form data for Python service
    const fd = new FormData();
    let endpoint = "/draft"; // default to certificate generation flow

    if (formDoc && template) {
      // Certificate generation flow: form + template
      if (!formDoc.name.toLowerCase().endsWith(".docx")) {
        return NextResponse.json(
          { error: "Form must be .docx format" },
          { status: 400 }
        );
      }
      if (!template.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "Template must be .pdf format" },
          { status: 400 }
        );
      }
      
      fd.append("form", new Blob([await formDoc.arrayBuffer()]), formDoc.name);
      fd.append("template", new Blob([await template.arrayBuffer()]), template.name);
    } else if (single) {
      // Generic conversion flow: single file
      if (!single.name.toLowerCase().endsWith(".doc") && !single.name.toLowerCase().endsWith(".docx")) {
        return NextResponse.json(
          { error: "File must be .doc or .docx format" },
          { status: 400 }
        );
      }
      
      endpoint = "/convert";
      fd.append("file", new Blob([await single.arrayBuffer()]), single.name);
    } else {
      return NextResponse.json(
        { error: "Upload either (form + template) or (file)" },
        { status: 400 }
      );
    }

    // Get PDF service URL from environment
    const pdfServiceUrl = process.env.PDF_SERVICE_URL;
    if (!pdfServiceUrl) {
      return NextResponse.json(
        { error: "PDF service not configured" },
        { status: 500 }
      );
    }

    // Forward request to Python service
    const response = await fetch(`${pdfServiceUrl}${endpoint}`, {
      method: "POST",
      body: fd,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("PDF service error:", errorText);
      return NextResponse.json(
        { error: `PDF service error: ${errorText}` },
        { status: response.status }
      );
    }

    // Get the generated PDF
    const pdfBuffer = await response.arrayBuffer();
    
    // Determine filename for download
    let downloadName = "output.pdf";
    if (formDoc) {
      downloadName = formDoc.name.replace(/\.\w+$/, "") + ".pdf";
    } else if (single) {
      downloadName = single.name.replace(/\.\w+$/, "") + ".pdf";
    }

    // Return the PDF with proper headers
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (error) {
    console.error("PDF API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

