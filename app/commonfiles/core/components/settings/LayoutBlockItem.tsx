'use client';

import React, { useRef } from 'react';
import { LayoutBlock, FieldMetadata } from './ObjectLayoutEditor';

interface LayoutBlockItemProps {
  block: LayoutBlock;
  fieldMetadata: FieldMetadata[];
  relatedLists: any[]; // Add relatedLists prop
  buttons: any[]; // Add buttons prop
  moveBlock: (draggedId: string, hoverId: string, draggedSection: string, hoverSection: string) => void;
  getFieldIcon: (dataType: string, isReference?: boolean) => string;
  handleEditField: (field: FieldMetadata) => void;
  isSystemField: (apiName: string) => boolean;
  onRemoveBlock: (blockId: string) => void;
  // Add related list props
  onEditRelatedList: (relatedList: any) => void;
  onDeleteRelatedList: (relatedListId: string, label: string) => void;
  onOpenRelatedListConfig: (layoutBlock: any) => void;
}

const LayoutBlockItem: React.FC<LayoutBlockItemProps> = ({
  block,
  fieldMetadata,
  relatedLists,
  buttons,
  moveBlock,
  getFieldIcon,
  handleEditField,
  isSystemField,
  onRemoveBlock,
  onEditRelatedList,
  onDeleteRelatedList,
  onOpenRelatedListConfig,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isOver, setIsOver] = React.useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.setData('application/json', JSON.stringify({ 
      id: block.id, 
      section: block.section 
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const item = JSON.parse(data);
        if (item.id !== block.id) {
          moveBlock(item.id, block.id, item.section, block.section);
        }
      } catch (error) {
        console.error('Error parsing drop data:', error);
      }
    }
  };

  if (block.block_type === 'field') {
    const field = fieldMetadata.find(f => f.id === block.field_id);
    if (!field) return null;

    return (
      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        className={`${block.width === 'full' ? 'col-span-2' : 'col-span-1'} bg-white border border-gray-200 rounded-lg p-3 cursor-grab hover:bg-gray-50 transition-colors ${
          isOver ? 'border-blue-300 bg-blue-50' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl">{getFieldIcon(field.field_type, !!field.reference_table)}</span>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-medium text-gray-900">{field.display_label}</h4>
                {isSystemField(field.api_name) && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    System
                  </span>
                )}
                {field.reference_table && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                    {field.reference_table}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">{field.api_name}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleEditField(field)}
              className="text-gray-400 hover:text-gray-500"
              title="Edit field"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button
              onClick={() => onRemoveBlock(block.id)}
              className="text-red-400 hover:text-red-500"
              title="Remove from layout"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Handle related list blocks
  if (block.block_type === 'related_list') {
    const relatedList = relatedLists.find(r => r.id === block.related_list_id);
    if (!relatedList) return null;

    return (
      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        className={`${block.width === 'full' ? 'col-span-2' : 'col-span-1'} bg-white border border-blue-200 rounded-lg p-3 cursor-grab hover:bg-blue-50 transition-colors ${
          isOver ? 'border-blue-300 bg-blue-50' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 h-8 w-8">
              <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-medium text-gray-900">{relatedList.label}</h4>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  {relatedList.child_table}
                </span>
                {block.tab_type === 'related_list' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Tab
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">{relatedList.foreign_key_field} → {relatedList.parent_table}</p>
              {block.display_columns && block.display_columns.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Columns: {block.display_columns.slice(0, 2).join(', ')}
                  {block.display_columns.length > 2 && ` +${block.display_columns.length - 2} more`}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onOpenRelatedListConfig(block)}
              className="text-blue-400 hover:text-blue-500"
              title="Configure related list"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => onRemoveBlock(block.id)}
              className="text-red-400 hover:text-red-500"
              title="Remove from layout"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Handle button blocks
  if (block.block_type === 'button') {
    const button = buttons.find(b => b.id === block.button_id);
    if (!button) return null;

    const getButtonIcon = (buttonType: string) => {
      switch (buttonType) {
        case 'custom':
          return '🔧';
        case 'object':
          return '📋';
        default:
          return '🔘';
      }
    };

    const getButtonStyle = (buttonStyle: string) => {
      switch (buttonStyle) {
        case 'primary':
          return 'bg-blue-500 text-white';
        case 'secondary':
          return 'bg-gray-500 text-white';
        case 'success':
          return 'bg-green-500 text-white';
        case 'danger':
          return 'bg-red-500 text-white';
        case 'warning':
          return 'bg-yellow-500 text-white';
        default:
          return 'bg-blue-500 text-white';
      }
    };

    return (
      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        className={`${block.width === 'full' ? 'col-span-2' : 'col-span-1'} bg-white border border-green-200 rounded-lg p-3 cursor-grab hover:bg-green-50 transition-colors ${
          isOver ? 'border-green-300 bg-green-50' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0 h-8 w-8">
              <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                <span className="text-sm">{getButtonIcon(button.button_type)}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-medium text-gray-900">{button.label || button.name}</h4>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {button.button_type}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getButtonStyle(button.button_style || 'primary')}`}>
                  {button.button_size || 'md'}
                </span>
              </div>
              <p className="text-xs text-gray-500">{button.action_type || 'No action'} • {button.button_type}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onRemoveBlock(block.id)}
              className="text-red-400 hover:text-red-500"
              title="Remove from layout"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default LayoutBlockItem;
