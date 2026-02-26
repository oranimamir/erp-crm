import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import SuppliersPage from './pages/SuppliersPage';
import SupplierDetailPage from './pages/SupplierDetailPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceFormPage from './pages/InvoiceFormPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';
import OrdersPage from './pages/OrdersPage';
import OrderFormPage from './pages/OrderFormPage';
import OrderDetailPage from './pages/OrderDetailPage';
import ShipmentsPage from './pages/ShipmentsPage';
import ShipmentFormPage from './pages/ShipmentFormPage';
import ShipmentDetailPage from './pages/ShipmentDetailPage';
import InventoryPage from './pages/InventoryPage';
import ProductionPage from './pages/ProductionPage';
import InvoiceGeneratorPage from './pages/InvoiceGeneratorPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import NotFoundPage from './pages/NotFoundPage';
import OperationsPage from './pages/OperationsPage';
import OperationDetailPage from './pages/OperationDetailPage';
import OperationFormPage from './pages/OperationFormPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import SharePointSyncPage from './pages/SharePointSyncPage';

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/invoices/new" element={<InvoiceFormPage />} />
              <Route path="/invoices/generate" element={<InvoiceGeneratorPage />} />
              <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="/invoices/:id/edit" element={<InvoiceFormPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/new" element={<OrderFormPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/orders/:id/edit" element={<OrderFormPage />} />
              <Route path="/shipments" element={<ShipmentsPage />} />
              <Route path="/shipments/new" element={<ShipmentFormPage />} />
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/shipments/:id/edit" element={<ShipmentFormPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/production" element={<ProductionPage />} />
              <Route path="/products" element={<Navigate to="/inventory" replace />} />
              <Route path="/operations" element={<OperationsPage />} />
              <Route path="/operations/new" element={<OperationFormPage />} />
              <Route path="/operations/:id" element={<OperationDetailPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/packaging" element={<Navigate to="/inventory" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/sharepoint-sync" element={<SharePointSyncPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
