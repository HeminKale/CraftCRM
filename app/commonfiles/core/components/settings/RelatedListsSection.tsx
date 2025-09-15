'use client';

import React from 'react';
import { useDrop } from 'react-dnd';
import { RelatedList, LayoutBlock, ItemTypes } from './ObjectLayoutEditor';

interface RelatedListsSectionProps {
  availableRelatedLists: RelatedList[];
  relatedListsInSection: LayoutBlock[];
  relatedLists: RelatedList[];
  onAddRelatedList: (relatedList: RelatedList, section: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onEditRelatedList: (relatedList: RelatedList) => void;
  onDeleteRelatedList: (relatedListId: string, label: string) => void;
  onDropFromPool: (dropResult: any) => void;
  onOpenRelatedListConfig: (layoutBlock: LayoutBlock) => void;
}

const RelatedListsSection: React.FC<RelatedListsSectionProps> = ({
  availableRelatedLists,
  relatedListsInSection,
  relatedLists,
  onAddRelatedList,
  onRemoveBlock,
  onEditRelatedList,
  onDeleteRelatedList,
  onDropFromPool,
  onOpenRelatedListConfig,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: [ItemTypes.RELATED_LIST],
    drop: (item: any) => {
      if (item.type === 'relatedList' && item.relatedList) {
        // Check for duplicates
        const isDuplicate = relatedListsInSection.some(
          block => block.related_list_id === item.relatedList.id
        );
        
        if (isDuplicate) {
          return;
        }
        
        // Add the related list with proper metadata
        onAddRelatedList(item.relatedList, 'related_lists');
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  return (
    <div
      // @ts-ignore
      ref={drop}
      className={`bg-blue-50 p-4 rounded-md shadow-sm transition-colors ${
        isOver && canDrop ? 'bg-blue-100 border-2 border-blue-300' : ''
      }`}
    >
      <h3 className="text-lg font-semibold mb-2 flex justify-between items-center">
        <span className="flex items-center space-x-2">
          <span>🔗 Related Lists</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            System Section
          </span>
        </span>
        <span className="text-sm text-blue-600 font-normal">
          {availableRelatedLists.length} available
        </span>
      </h3>
      
      <div className="space-y-3">
        {relatedListsInSection.length === 0 ? (
          <div className="text-center py-8 text-blue-500 border-2 border-dashed border-blue-200 rounded-lg">
            <div className="text-2xl mb-2">🔗</div>
            <p className="text-sm font-medium">Drop related lists here</p>
            <p className="text-xs text-blue-400 mt-1">
              Drag from the Related Lists pool above
            </p>
          </div>
        ) : (
          relatedListsInSection.map((block) => {
            const relatedList = relatedLists.find(rl => rl.id === block.related_list_id);
            
            return (
              <div
                key={block.id}
                className="bg-white border border-blue-200 rounded-lg p-3 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-xl">🔗</span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-sm font-medium text-blue-900">{block.label}</h4>
                        {relatedList && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {relatedList.child_table}
                          </span>
                        )}
                        {block.tab_type && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {block.tab_type}
                          </span>
                        )}
                      </div>
                      {relatedList && (
                        <p className="text-xs text-blue-600">
                          FK: {relatedList.foreign_key_field}
                        </p>
                      )}
                      {block.display_columns && (
                        <p className="text-xs text-blue-500">
                          Fields: {block.display_columns.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {relatedList && (
                      <>
                        <button
                          onClick={() => onOpenRelatedListConfig(block)}
                          className="text-blue-400 hover:text-blue-500"
                          title="Configure related list fields"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDeleteRelatedList(relatedList.id, relatedList.label)}
                          className="text-red-400 hover:text-red-500"
                          title="Delete related list"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
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
          })
        )}
      </div>
    </div>
  );
};

export default RelatedListsSection;
