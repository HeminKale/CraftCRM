'use client';

import React, { useCallback, memo } from 'react';
import { RelatedList } from './ObjectLayoutEditor';

interface RelatedListPoolItemProps {
  relatedList: RelatedList;
  onAddToLayout: (relatedList: RelatedList) => void;
}

const RelatedListPoolItem: React.FC<RelatedListPoolItemProps> = ({
  relatedList,
  onAddToLayout,
}) => {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'relatedList',
      id: relatedList.id,
      relatedList: relatedList,
      section: 'pool'
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, [relatedList]);

  const handleClick = useCallback(() => {
    onAddToLayout(relatedList);
  }, [onAddToLayout, relatedList]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className="bg-white border border-gray-200 rounded-lg p-3 cursor-grab hover:bg-gray-50 transition-colors hover:border-blue-300 hover:shadow-sm"
      title={`Drag to add ${relatedList.label} to layout or click to add`}
    >
      <div className="flex items-center space-x-3">
        <div className="flex-shrink-0 h-8 w-8">
          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h4 className="text-sm font-medium text-gray-900 truncate">{relatedList.label}</h4>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              {relatedList.child_table}
            </span>
          </div>
          <div className="flex items-center space-x-2 mt-1">
            <p className="text-xs text-gray-500 font-mono">{relatedList.foreign_key_field}</p>
            <span className="text-xs text-gray-400">→</span>
            <p className="text-xs text-gray-500">{relatedList.parent_table}</p>
          </div>
          {relatedList.display_columns && relatedList.display_columns.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Display columns:</p>
              <div className="flex flex-wrap gap-1">
                {relatedList.display_columns.slice(0, 3).map((column, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                  >
                    {column}
                  </span>
                ))}
                {relatedList.display_columns.length > 3 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                    +{relatedList.display_columns.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default memo(RelatedListPoolItem);
