import { useEffect, useState } from 'react';

let toastQueue = [];
let setToastFn = null;

export function showToast(message, type = 'info') {
  if (setToastFn) {
    setToastFn({ message, type, id: Date.now() });
  }
}

export default function Toast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setToastFn = setToast;
    return () => { setToastFn = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  const colours = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-gray-800',
    warning: 'bg-orange-500',
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-white text-sm font-medium shadow-xl transition-all ${colours[toast.type] || colours.info}`}
    >
      {toast.message}
    </div>
  );
}
