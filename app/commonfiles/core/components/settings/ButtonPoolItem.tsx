'use client';

import React, { useCallback } from 'react';
import { Button } from './ObjectLayoutEditor';

interface ButtonPoolItemProps {
  button: Button;
  onAddButton: (button: Button, section: string) => void;
  availableSections: string[];
  sectionTypes: Record<string, 'field' | 'related_list' | 'mixed'>;
}

const ButtonPoolItem: React.FC<ButtonPoolItemProps> = ({
  button,
  onAddButton,
  availableSections,
  sectionTypes,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    setIsDragging(true);
    const dragData = { 
      type: 'button',
      button: button,
      section: 'pool' 
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
  }, [button]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

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

  const handleAddToSection = (section: string) => {
    onAddButton(button, section);
  };

  // Filter sections that can accept buttons (mixed or field sections)
  const compatibleSections = availableSections.filter(section => 
    sectionTypes[section] === 'mixed' || sectionTypes[section] === 'field'
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`p-2 border rounded-md cursor-move transition-all ${
        isDragging
          ? 'opacity-50 bg-blue-50 border-blue-300'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm">{getButtonIcon(button.button_type)}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">
              {button.label || button.name}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {button.button_type} • {button.action_type || 'No action'}
            </div>
          </div>
        </div>
        
        {/* Button style preview */}
        <div className={`px-2 py-1 text-xs rounded ${getButtonStyle(button.button_style || 'primary')}`}>
          {button.button_size || 'md'}
        </div>
      </div>

      {/* Quick add buttons for compatible sections */}
      {compatibleSections.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500 mb-1">Quick add to:</div>
          <div className="flex flex-wrap gap-1">
            {compatibleSections.slice(0, 3).map((section) => (
              <button
                key={section}
                onClick={() => handleAddToSection(section)}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
              >
                {section}
              </button>
            ))}
            {compatibleSections.length > 3 && (
              <span className="px-2 py-1 text-xs text-gray-500">
                +{compatibleSections.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ButtonPoolItem;
