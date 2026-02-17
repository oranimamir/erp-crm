import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className = '', ...props }, ref) => (
  <div className="space-y-1">
    {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
    <input
      ref={ref}
      className={`block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${error ? 'border-red-300 text-red-900' : 'border-gray-300 text-gray-900'} ${className}`}
      {...props}
    />
    {error && <p className="text-sm text-red-600">{error}</p>}
  </div>
));

Input.displayName = 'Input';
export default Input;
