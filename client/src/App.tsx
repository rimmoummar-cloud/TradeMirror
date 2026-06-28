import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthGuard } from "./components/layout/AuthGuard";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { AcceptInvitePage } from "./pages/auth/AcceptInvitePage";
import { UsersPage } from "./pages/users/UsersPage";
import { DashboardHome } from "./pages/dashboard/DashboardHome";
import { TradesListPage } from "./pages/trades/TradesListPage";
import { TradeDetailsPage } from "./pages/trades/TradeDetailsPage";
import { ClientsListPage } from "./pages/clients/ClientsListPage";
import { ClientDetailsPage } from "./pages/clients/ClientDetailsPage";
import { LogsPage } from "./pages/logs/LogsPage";
import { UploadPage } from "./pages/UploadPage";
import { EditPage } from "./pages/EditPage";
import { PreviewPage } from "./pages/PreviewPage";
import { useAuthStore } from "./store/authStore";

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Protected App Routes */}
      <Route path="/app" element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<DashboardHome />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="trades" element={<TradesListPage />} />
          <Route path="trades/:id" element={<TradeDetailsPage />} />
          <Route path="clients" element={<ClientsListPage />} />
          <Route path="clients/:id" element={<ClientDetailsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="users" element={<UsersPage />} />
          
          {/* Editor and Generate routes */}
          <Route path="editor/:id" element={<EditPage />} />
          <Route path="generate/:id" element={<PreviewPage />} />
        </Route>
      </Route>

      {/* Fallback Redirection */}
      <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
    </Routes>
  );
}
