import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { useAuth } from "./context/AuthContext";
import { AppLayout } from "./components/AppLayout";
import { ContactChatbotWidget } from "./components/ContactChatbotWidget";
import { LoadingScreen } from "./components/LoadingScreen";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InterviewPage } from "./pages/InterviewPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ResumeBuilderPage } from "./pages/ResumeBuilderPage";
import { CareerCounsellingPage } from "./pages/CareerCounsellingPage";
import { JobsPage } from "./pages/JobsPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { PaymentPage } from "./pages/PaymentPage";
import { QuestionBankPage } from "./pages/QuestionBankPage";
import { ReplayHubPage } from "./pages/ReplayHubPage";
import { AdminPanelPage } from "./pages/AdminPanelPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { SsoCallbackPage } from "./pages/SsoCallbackPage";
import { authApi } from "./lib/api";
import { clearAdminToken, getAdminToken } from "./lib/adminAuth";
const ADMIN_LOGIN_URL = "/admin-login?next=/admin";
function AdminRouteGate() {
  const { user, isAuthenticated, logout } = useAuth();
  const [state, setState] = useState({
    checking: true,
    allowed: false,
    adminToken: ""
  });
  useEffect(() => {
    let cancelled = false;
    async function verifyAccess() {
      const storedAdminToken = getAdminToken();
      if (storedAdminToken) {
        try {
          const payload = await authApi.me(storedAdminToken);
          if (!cancelled && payload?.user?.role === "admin") {
            setState({ checking: false, allowed: true, adminToken: storedAdminToken });
            return;
          }
        } catch (error) {
        }
        clearAdminToken();
      }
      if (isAuthenticated) {
        if (user?.role === "admin") {
          if (!cancelled) {
            setState({ checking: false, allowed: true, adminToken: "" });
          }
          return;
        }
        if (!cancelled) {
          setState({ checking: false, allowed: false, adminToken: "" });
        }
        return;
      }
      if (!cancelled) {
        setState({ checking: false, allowed: false, adminToken: "" });
      }
    }
    verifyAccess();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.role]);
  if (state.checking) {
    return <LoadingScreen label="Verifying admin access..." />;
  }
  if (!state.allowed) {
    return <Navigate to={ADMIN_LOGIN_URL} replace />;
  }
  if (isAuthenticated) {
    return <AppLayout user={user} onLogout={logout}><AdminPanelPage adminToken={state.adminToken} /></AppLayout>;
  }
  return <div className="p-4 md:p-6"><AdminPanelPage adminToken={state.adminToken} /></div>;
}
function PrivateRoutes() {
  const { user, logout } = useAuth();
  if (user?.role === "admin") {
    return <Navigate to="/admin" replace />;
  }
  return <AppLayout user={user} onLogout={logout}><Routes><Route path="/" element={<DashboardPage />} /><Route path="/interview" element={<InterviewPage />} /><Route path="/history" element={<HistoryPage />} /><Route path="/leaderboard" element={<LeaderboardPage />} /><Route path="/resume-builder" element={<ResumeBuilderPage />} /><Route path="/career-counselling" element={<CareerCounsellingPage />} /><Route path="/jobs" element={<JobsPage />} /><Route path="/subscriptions" element={<SubscriptionsPage />} /><Route path="/subscriptions/payment" element={<PaymentPage />} /><Route path="/question-bank" element={<QuestionBankPage />} /><Route path="/replay-hub" element={<ReplayHubPage />} /><Route path="/profile" element={<ProfilePage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></AppLayout>;
}
export default function App() {
  const { loading, isAuthenticated } = useAuth();
  if (loading) {
    return <LoadingScreen label="Authenticating..." />;
  }
  return <><Routes><Route path="/admin-login" element={<AdminLoginPage />} /><Route path="/admin" element={<AdminRouteGate />} /><Route path="/sso-callback" element={<SsoCallbackPage />} />{isAuthenticated ? <Route path="/*" element={<PrivateRoutes />} /> : <Route path="*" element={<AuthPage />} />}</Routes><ContactChatbotWidget /><Analytics /></>;
}