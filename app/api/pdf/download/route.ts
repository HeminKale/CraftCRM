import { NextRequest, NextResponse } from "next/server";
import fs from 'fs';
import path from 'path';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json(
        { error: 'File path is required' },
        { status: 400 }
      );
    }

    // Security check: ensure the path is within allowed directories
    const normalizedPath = path.normalize(filePath);
    const allowedBaseDir = process.env.PDF_OUTPUT_DIR || '/tmp';
    
    if (!normalizedPath.startsWith(allowedBaseDir)) {
      return NextResponse.json(
        { error: 'Access denied: Invalid file path' },
        { status: 403 }
      );
    }

    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Read the file
    const fileBuffer = fs.readFileSync(normalizedPath);
    
    // Get filename from path
    const filename = path.basename(normalizedPath);

    // Return the file
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (error) {
    console.error("PDF download API error:", error);
    
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
