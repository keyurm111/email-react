import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onClose: () => void;
}

export const Toast = ({ message, type, onClose }: ToastProps) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(onClose, 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle',
  };

  const colors = {
    success: 'border-l-green-500 text-green-500',
    error: 'border-l-red-500 text-red-500',
    warning: 'border-l-orange-500 text-orange-500',
    info: 'border-l-blue-500 text-blue-500',
  };

  return (
    <div
      className={`bg-white rounded-lg shadow-xl p-4 flex items-center gap-3 min-w-[300px] border-l-4 ${
        colors[type]
      } transform transition-transform duration-300 ${
        show ? 'translate-x-0' : 'translate-x-[400px]'
      }`}
    >
      <i className={`fas ${icons[type]} text-xl`}></i>
      <span className="flex-1">{message}</span>
      <button
        onClick={() => {
          setShow(false);
          setTimeout(onClose, 300);
        }}
        className="text-gray-400 hover:text-gray-600"
      >
        <i className="fas fa-times"></i>
      </button>
    </div>
  );
};

