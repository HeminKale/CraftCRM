import React from 'react';

interface UniversalFieldDisplayProps {
  record: any;
  fieldName: string;
  fieldValue: any;
  fieldType?: string;
  referenceTable?: string;
  referenceDisplayField?: string;
  tenantId: string;
  recordId?: string;
  className?: string;
  isClickable?: boolean;
  onClick?: () => void;
}

export const UniversalFieldDisplay: React.FC<UniversalFieldDisplayProps> = ({
  record,
  fieldName,
  fieldValue,
  fieldType,
  referenceTable,
  referenceDisplayField,
  tenantId,
  recordId,
  className = '',
  isClickable = false,
  onClick,
}) => {
  // Get the smart field value (handles __a suffixes, etc.)
  const getSmartFieldValue = (record: any, fieldName: string): any => {
    let fieldValue = record[fieldName];
    
    // If not found, try with __a suffix
    if (fieldValue === undefined && !fieldName.endsWith('__a')) {
      fieldValue = record[`${fieldName}__a`];
    }
    
    // If still not found, try with _a suffix
    if (fieldValue === undefined && !fieldName.endsWith('_a')) {
      fieldValue = record[`${fieldName}_a`];
    }
    
    // If still not found, try snake_case version
    if (fieldValue === undefined) {
      const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
      fieldValue = record[snakeCase];
    }
    
    // If still not found, try snake_case with __a suffix
    if (fieldValue === undefined) {
      const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
      fieldValue = record[`${snakeCase}__a`];
    }
    
    return fieldValue;
  };

  const smartValue = getSmartFieldValue(record, fieldName);
  const displayValue = smartValue || fieldValue || '-';

  // Base classes for all field displays
  const baseClasses = 'text-sm text-gray-900';
  
  // Classes for clickable elements
  const clickableClasses = isClickable ? 'cursor-pointer hover:bg-gray-100' : '';
  
  const finalClasses = `${baseClasses} ${clickableClasses} ${className}`.trim();

  // Render clickable elements
  if (isClickable || onClick) {
    return (
      <div
        className={finalClasses}
        onClick={onClick}
      >
        {displayValue}
      </div>
    );
  }

  // Render non-clickable elements
  return (
    <div className={finalClasses}>
      {displayValue}
    </div>
  );
};

// Helper function to format column labels
export const formatColumnLabel = (columnName: string): string => {
  // Convert snake_case to Title Case
  return columnName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};