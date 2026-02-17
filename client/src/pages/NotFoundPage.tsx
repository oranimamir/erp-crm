import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-6xl font-bold text-gray-200">404</h1>
      <p className="text-lg text-gray-600 mt-2">Page not found</p>
      <Link to="/dashboard" className="mt-6 inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
        <Home size={16} />
        Back to Dashboard
      </Link>
    </div>
  );
}
