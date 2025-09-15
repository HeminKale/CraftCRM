import React, { useEffect, useState } from 'react';

interface MessageProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  onDismiss?: () => void;
  autoDismiss?: boolean;
  dismissDelay?: number;
}

const Message: React.FC<MessageProps> = ({
  message,
  type = 'info',
  onDismiss,
  autoDismiss = true,
  dismissDelay = 5000
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (autoDismiss && message) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, dismissDelay);

      return () => clearTimeout(timer);
    }
  }, [message, autoDismiss, dismissDelay, onDismiss]);

  if (!isVisible || !message) {
    return null;
  }

  const getMessageStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'error':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'warning':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'info':
      default:
        return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  return (
    <div className={`mb-4 p-3 rounded-md border ${getMessageStyles()} flex items-center justify-between`}>
      <div className="flex items-center">
        <span className="mr-2">{getIcon()}</span>
        <span>{message}</span>
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          onDismiss?.();
        }}
        className="ml-2 text-gray-400 hover:text-gray-600"
        title="Dismiss message"
      >
        ×
      </button>
    </div>
  );
};

export default Message;
