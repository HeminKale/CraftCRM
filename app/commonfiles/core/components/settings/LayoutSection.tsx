'use client';

import React, { useRef } from 'react';
import { LayoutBlock, FieldMetadata, SectionType } from './ObjectLayoutEditor';
import LayoutBlockItem from './LayoutBlockItem';

interface LayoutSectionProps {
  section: string;
  sectionType: SectionType; // Add section type prop
  blocks: LayoutBlock[];
  fieldMetadata: FieldMetadata[];
  relatedLists: any[]; // Add relatedLists prop
  buttons: any[]; // Add buttons prop
  moveBlock: (draggedId: string, hoverId: string, draggedSection: string, hoverSection: string) => void;
  onRemoveSection: (sectionName: string) => void;
  onRenameSection: (sectionName: string) => void;
  getFieldIcon: (dataType: string, isReference?: boolean) => string;
  handleEditField: (field: FieldMetadata) => void;
  isSystemField: (apiName: string) => boolean;
  onRemoveBlock: (blockId: string) => void;
  onDropFromPool: (dropResult: any) => void;
  // Add related list props
  onEditRelatedList: (relatedList: any) => void;
  onDeleteRelatedList: (relatedListId: string, label: string) => void;
  onOpenRelatedListConfig: (layoutBlock: any) => void;
}

const LayoutSection: React.FC<LayoutSectionProps> = ({
  section,
  sectionType,
  blocks,
  fieldMetadata,
  relatedLists,
  buttons,
  moveBlock,
  onRemoveSection,
  onRenameSection,
  getFieldIcon,
  handleEditField,
  isSystemField,
  onRemoveBlock,
  onDropFromPool,
  onEditRelatedList,
  onDeleteRelatedList,
  onOpenRelatedListConfig,
}) => {
  const [isOver, setIsOver] = React.useState(false);

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
        
        // Respect section type restrictions instead of blanket blocking
        if (item.type === 'relatedList' && sectionType === 'field') {
          return;
        }
        
        if (item.type === 'field' && sectionType === 'related_list') {
          return;
        }
        
        // Buttons are not allowed in layout sections - they appear in the header
        if (item.type === 'button') {
          return;
        }
        
        if (item.section === 'pool') {
          onDropFromPool({ ...item, targetSection: section });
        } else if (item.section !== section) {
          moveBlock(item.id, '', item.section, section);
        }
      } catch (error) {
        console.error('Error parsing drop data:', error);
      }
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`bg-gray-50 p-4 rounded-md shadow-sm transition-colors ${
        isOver ? 'bg-blue-50 border-2 border-blue-300' : ''
      }`}
    >
      <h3 className="text-lg font-semibold mb-2 flex justify-between items-center">
        <span className="flex items-center space-x-2">
          <span>{section}</span>
          {/* Section Type Badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            sectionType === 'field' ? 'bg-green-100 text-green-800' :
            sectionType === 'related_list' ? 'bg-blue-100 text-blue-800' :
            'bg-purple-100 text-purple-800'
          }`}>
            {sectionType === 'field' && '📝 Fields Only'}
            {sectionType === 'related_list' && '🔗 Related Lists Only'}
            {sectionType === 'mixed' && '🔄 Mixed (Fields & Lists)'}
          </span>
        </span>
        {section !== 'basic' && section !== 'system' && (
          <div className="flex items-center space-x-4">
            <button
              onClick={() => onRenameSection(section)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              Rename
            </button>
            {section !== 'details' && (
              <button
                onClick={() => onRemoveSection(section)}
                className="text-red-600 hover:text-red-800 text-sm font-medium"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        {blocks.length === 0 && (
          <p className="text-gray-500 col-span-2">
            {sectionType === 'field' && 'Drag fields here.'}
            {sectionType === 'related_list' && 'Drag related lists here.'}
            {sectionType === 'mixed' && 'Drag fields or related lists here.'}
          </p>
        )}
        {blocks.map((block) => (
          <LayoutBlockItem
            key={block.id}
            block={block}
            fieldMetadata={fieldMetadata}
            relatedLists={relatedLists}
            buttons={buttons}
            moveBlock={moveBlock}
            getFieldIcon={getFieldIcon}
            handleEditField={handleEditField}
            isSystemField={isSystemField}
            onRemoveBlock={onRemoveBlock}
            onEditRelatedList={onEditRelatedList}
            onDeleteRelatedList={onDeleteRelatedList}
            onOpenRelatedListConfig={onOpenRelatedListConfig}
          />
        ))}
      </div>
    </div>
  );
};

export default LayoutSection;
