"use client";

import React, { useState } from "react";
import { Upload, FileText, Download, AlertCircle, CheckCircle } from "lucide-react";

export default function CertificateGeneratorPage() {
  const [formDoc, setFormDoc] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFormUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".docx")) {
      setFormDoc(file);
      setError(null);
    } else {
      setError("Please select a valid .docx file");
    }
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".pdf")) {
      setTemplate(file);
      setError(null);
    } else {
      setError("Please select a valid .pdf template file");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formDoc || !template) {
      setError("Please upload both a Word form and PDF template");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append("form", formDoc);
      formData.append("template", template);

      const response = await fetch("/api/pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate certificate");
      }

      // Get the PDF blob and download it
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = formDoc.name.replace(/\.docx$/, ".pdf");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess("Certificate generated successfully! Download started.");
      
      // Reset form
      setFormDoc(null);
      setTemplate(null);
      
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setFormDoc(null);
    setTemplate(null);
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Certificate Generator
          </h1>
          <p className="text-lg text-gray-600">
            Generate professional certificates from Word forms and PDF templates
          </p>
        </div>

        {/* Main Form */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: Upload Word Form */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Step 1: Upload Word Form (.docx)
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept=".docx"
                  onChange={handleFormUpload}
                  className="hidden"
                  id="form-upload"
                  disabled={isProcessing}
                />
                <label
                  htmlFor="form-upload"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <Upload className="h-12 w-12 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">
                    {formDoc ? formDoc.name : "Click to upload Word form"}
                  </span>
                </label>
              </div>
              {formDoc && (
                <div className="mt-2 flex items-center text-sm text-green-600">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {formDoc.name} uploaded
                </div>
              )}
            </div>

            {/* Step 2: Upload PDF Template */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Step 2: Upload PDF Template
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleTemplateUpload}
                  className="hidden"
                  id="template-upload"
                  disabled={isProcessing}
                />
                <label
                  htmlFor="template-upload"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <FileText className="h-12 w-12 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">
                    {template ? template.name : "Click to upload PDF template"}
                  </span>
                </label>
              </div>
              {template && (
                <div className="mt-2 flex items-center text-sm text-green-600">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {template.name} uploaded
                </div>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
                  <span className="text-sm text-red-700">{error}</span>
                </div>
              </div>
            )}

            {/* Success Display */}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex">
                  <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
                  <span className="text-sm text-green-700">{success}</span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-4">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                disabled={isProcessing}
              >
                Reset
              </button>
              
              <button
                type="submit"
                disabled={!formDoc || !template || isProcessing}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <Download className="h-4 w-4 mr-2" />
                    Generate Certificate
                  </div>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900 mb-3">
            How to Use
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
            <li>Upload a Word document (.docx) containing your form data</li>
            <li>Upload a PDF template file for the certificate design</li>
            <li>Click "Generate Certificate" to process your files</li>
            <li>Download the generated PDF certificate</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

