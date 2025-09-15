'use client';

import React, { useState, useEffect } from 'react';
import { Edit3, Save, X, CheckCircle, AlertCircle } from 'lucide-react';

interface FormField {
  key: string;
  value: string;
  label: string;
  required?: boolean;
}

interface FieldEditorProps {
  fields: Record<string, string>;
  onFieldsChange: (fields: Record<string, string>) => void;
  onSave: () => void;
  isEditing: boolean;
  onToggleEdit: () => void;
}

export default function FieldEditor({ 
  fields, 
  onFieldsChange, 
  onSave, 
  isEditing, 
  onToggleEdit 
}: FieldEditorProps) {
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize edited fields when fields prop changes
  useEffect(() => {
    setEditedFields(fields);
    setHasChanges(false);
  }, [fields]);

  // Check if there are unsaved changes
  useEffect(() => {
    const changed = Object.keys(fields).some(key => 
      fields[key] !== editedFields[key]
    );
    setHasChanges(changed);
  }, [fields, editedFields]);

  const handleFieldChange = (key: string, value: string) => {
    setEditedFields(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = () => {
    onFieldsChange(editedFields);
    onSave();
    setHasChanges(false);
  };

  const handleCancel = () => {
    setEditedFields(fields);
    setHasChanges(false);
    onToggleEdit();
  };

  // Convert field keys to user-friendly labels
  const getFieldLabel = (key: string): string => {
    const labelMap: Record<string, string> = {
      'Company Name': 'Company Name',
      'Address': 'Address',
      'ISO Standard': 'ISO Standard',
      'Scope': 'Scope',
      'management_system': 'Management System',
      'Company Name and Address': 'Company Name & Address'
    };
    return labelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Check if field is required
  const isFieldRequired = (key: string): boolean => {
    const requiredFields = ['Company Name', 'ISO Standard'];
    return requiredFields.includes(key);
  };

  // Group fields into left and right columns for better layout
  // Show all fields by default, but prioritize important ones
  const priorityFields = ['Company Name', 'ISO Standard', 'Address', 'Scope'];
  const otherFields = Object.keys(fields).filter(key => !priorityFields.includes(key));

  const renderField = (key: string, value: string) => {
    const label = getFieldLabel(key);
    const required = isFieldRequired(key);
    const isLongText = key === 'Scope' || key === 'Address' || key.toLowerCase().includes('address');

    return (
      <div key={key} className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        
        {isLongText ? (
          <textarea
            value={editedFields[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            disabled={!isEditing}
            className={`w-full px-3 py-2 border rounded-md resize-none ${
              isEditing 
                ? 'border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500' 
                : 'border-gray-200 bg-gray-50'
            }`}
            rows={4}
            placeholder={`Enter ${label.toLowerCase()}...`}
          />
        ) : (
          <input
            type="text"
            value={editedFields[key] || ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            disabled={!isEditing}
            className={`w-full px-3 py-2 border rounded-md ${
              isEditing 
                ? 'border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500' 
                : 'border-gray-200 bg-gray-50'
            }`}
            placeholder={`Enter ${label.toLowerCase()}...`}
          />
        )}
        
        {required && !editedFields[key] && (
          <p className="text-red-500 text-sm mt-1">This field is required</p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          Form Fields
        </h3>
        
        <div className="flex gap-2">
          {!isEditing ? (
            <button
              onClick={onToggleEdit}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
            >
              <Edit3 className="h-4 w-4" />
              Edit Fields
            </button>
          ) : (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 border border-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="h-4 w-4" />
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {hasChanges && isEditing && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex items-center gap-2 text-yellow-700">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">You have unsaved changes</span>
          </div>
        </div>
      )}

      {/* Fields Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Priority Fields */}
        <div>
          <h4 className="text-md font-medium text-gray-700 mb-4 pb-2 border-b border-gray-200">
            Priority Fields
          </h4>
          {priorityFields.map(key => 
            fields[key] && renderField(key, fields[key])
          )}
        </div>

        {/* Right Column - Other Fields */}
        <div>
          <h4 className="text-md font-medium text-gray-700 mb-4 pb-2 border-b border-gray-200">
            Other Fields
          </h4>
          {otherFields.map(key => 
            renderField(key, fields[key])
          )}
        </div>
      </div>

      {/* Show all fields in a single grid if there are many fields */}
      {Object.keys(fields).length > 8 && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="text-md font-medium text-gray-700 mb-4">
            All Fields (Grid View)
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Object.keys(fields).map(key => renderField(key, fields[key]))}
          </div>
        </div>
      )}

      {/* Field Count */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Total fields extracted: {Object.keys(fields).length}
        </p>
      </div>
    </div>
  );
}
