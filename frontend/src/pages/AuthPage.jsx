import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  AtSign,
  Bookmark,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Eye,
  EyeOff,
  FileText,
  Linkedin,
  Lock,
  Star,
  TrendingUp,
  Users,
  UserRound,
  Video } from
"lucide-react";
import { useAuth } from "../context/AuthContext";
import { API_BASE } from "../lib/api";
const mentorBadges = [
{ name: "Tanmay", tone: "from-cyan-400 to-blue-600" },
{ name: "Nina", tone: "from-violet-400 to-indigo-600" },
{ name: "Ichha", tone: "from-amber-300 to-orange-500" }];

const impactStats = [
{ label: "Expert Counsellors", value: "14+", icon: Users },
{ label: "Sessions Completed", value: "5+", icon: CheckCircle2 },
{ label: "Average Rating", value: "4.8", icon: Star },
{ label: "Available Slots", value: "24/7", icon: Clock3 }];

const productMenuItems = [
{
  label: "Interview Simulation",
  description: "Practice interviews with AI-powered feedback",
  icon: Video
},
{
  label: "AI Resume Enhancer",
  description: "Create professional, ATS-optimized resumes. If you do not have a resume, you can create one here.",
  icon: FileText
},
{
  label: "Knowledge Vault",
  description: "(coming soon)",
  icon: Database
}];

const jobsMenuItems = [
{
  label: "Browse Jobs",
  description: "Explore thousands of job opportunities",
  icon: Briefcase
},
{
  label: "Saved Jobs",
  description: "View and manage your saved positions",
  icon: Bookmark
}];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oauthProviders = {
  Google: "google",
  LinkedIn: "linkedin"
};
const heroContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      delayChildren: 0.08,
      staggerChildren: 0.12
    }
  }
};
const heroItemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1]
    }
  }
};
export function AuthPage() {
  const { login, signup, authMessage, clearAuthMessage } = useAuth();
  const [mode, setMode] = useState("login");
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [authOnlyView, setAuthOnlyView] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [oauthAvailability, setOauthAvailability] = useState({ google: true, linkedin: true });
  const [oauthCallbackUrls, setOauthCallbackUrls] = useState({ google: "", linkedin: "" });
  const [openMenu, setOpenMenu] = useState(null);
  const navRef = useRef(null);
  const isLogin = mode === "login";
  const isLandingView = !authOnlyView && !showAuthPanel;
  useEffect(() => {
    function handleOutsideClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authMode = urlParams.get("auth");
    const viewMode = urlParams.get("view");
    const isAuthOnly = viewMode === "auth";
    setAuthOnlyView(isAuthOnly);
    if (authMode === "signup") {
      setShowAuthPanel(true);
      setMode("signup");
      setOpenMenu(null);
      setError("");
      setNotice("");
    } else if (authMode === "login") {
      setShowAuthPanel(true);
      setMode("login");
      setOpenMenu(null);
      setError("");
      setNotice("");
    } else if (isAuthOnly) {
      setShowAuthPanel(true);
      setMode("login");
      setOpenMenu(null);
      setError("");
      setNotice("");
    } else {
      setShowAuthPanel(false);
    }
  }, []);
  useEffect(() => {
    if (!authMessage) {
      return;
    }
    setAuthOnlyView(true);
    setShowAuthPanel(true);
    setMode("login");
    setOpenMenu(null);
    setNotice("");
    setError(authMessage);
    clearAuthMessage();
  }, [authMessage, clearAuthMessage]);
  useEffect(() => {
    let cancelled = false;
    async function loadOauthAvailability() {
      try {
        const response = await fetch(`${API_BASE}/auth/oauth/providers`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = await response.json().catch(() => ({}));
        const providers = Array.isArray(payload?.providers) ? payload.providers : [];
        const availability = { google: true, linkedin: true };
        const callbacks = { google: "", linkedin: "" };
        for (const item of providers) {
          const providerKey = String(item?.provider || "").trim().toLowerCase();
          if (providerKey === "google" || providerKey === "linkedin") {
            availability[providerKey] = Boolean(item?.configured);
            callbacks[providerKey] = String(item?.callbackUrl || "").trim();
          }
        }
        if (!cancelled) {
          setOauthAvailability(availability);
          setOauthCallbackUrls(callbacks);
        }
      } catch {
      }
    }
    loadOauthAvailability();
    return () => {
      cancelled = true;
    };
  }, []);
  function updateField(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  function updateMode(nextMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }
  function openAuthPanel(nextMode = "login") {
    setAuthOnlyView(true);
    setShowAuthPanel(true);
    updateMode(nextMode);
  }
  function toggleMenu(menuKey) {
    setOpenMenu((previous) => previous === menuKey ? null : menuKey);
  }
  function handleNavAction(label) {
    setOpenMenu(null);
    setError("");
    openAuthPanel("login");
    const navNotices = {
      "Interview Simulation": "Log in to start interview simulations from your dashboard.",
      "AI Resume Enhancer": "Create an account, then open Resume Builder from the dashboard. If you do not have a resume, you can create one from scratch there.",
      "Knowledge Vault": "Knowledge Vault is coming soon. Use Interview Simulation for now.",
      "Browse Jobs": "Log in and open the Jobs tab to browse openings.",
      "Saved Jobs": "Log in to manage your saved jobs list.",
      Pricing: "Log in and open Subscriptions to view all plans.",
      "About Us": "About details are in your dashboard help center after login."
    };
    setNotice(navNotices[label] || `${label} is available after login.`);
  }
  function handleSignUpCta() {
    setOpenMenu(null);
    openAuthPanel("signup");
  }
  function handleLoginCta() {
    setOpenMenu(null);
    openAuthPanel("login");
  }
  function handleForgotPassword() {
    const email = String(form.email || "").trim().toLowerCase();
    setError("");
    setNotice("");
    if (!emailPattern.test(email)) {
      setError("Enter a valid email, then click Forgot Password.");
      return;
    }
    const mailtoUrl = `mailto:support@aiinterviewprep.com?subject=${encodeURIComponent(
      "Password reset request"
    )}&body=${encodeURIComponent(`Hello Support,
Please help reset my password for: ${email}

Thanks.`)}`;
    window.location.href = mailtoUrl;
    setNotice(`Password reset draft opened for ${email}.`);
  }
  async function handleSocialLogin(providerName) {
    const providerKey = oauthProviders[providerName];
    if (!providerKey) {
      return;
    }
    if (oauthAvailability[providerKey] === false) {
      setNotice("");
      const idVars = providerKey === "google" ? "GOOGLE_OAUTH_CLIENT_ID or GOOGLE_CLIENT_ID" : "LINKEDIN_OAUTH_CLIENT_ID or LINKEDIN_CLIENT_ID/LINKEDIN_KEY";
      const secretVars = providerKey === "google" ? "GOOGLE_OAUTH_CLIENT_SECRET or GOOGLE_CLIENT_SECRET" : "LINKEDIN_OAUTH_CLIENT_SECRET or LINKEDIN_CLIENT_SECRET/LINKEDIN_SECRET";
      const callbackUrl = oauthCallbackUrls[providerKey] || `${window.location.origin}/api/auth/oauth/${providerKey}/callback`;
      const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      const setupTarget = isLocal ? "backend/.env.local" : "Vercel Project Settings -> Environment Variables";
      const nextStep = isLocal ? "then restart backend." : "then redeploy.";
      setError(
        `${providerName} OAuth is not configured. Add ${idVars} and ${secretVars} in ${setupTarget}, set callback URL to ${callbackUrl}, ${nextStep}`
      );
      return;
    }
    setError("");
    setNotice(`Redirecting to ${providerName} login...`);
    const redirectUri = `${window.location.origin}/sso-callback?provider=${encodeURIComponent(providerKey)}`;
    const startUrl = `${API_BASE}/auth/oauth/${providerKey}/start?redirectUri=${encodeURIComponent(redirectUri)}`;
    window.location.assign(startUrl);
  }
  function handleFooterAction(label) {
    setError("");
    if (label === "Contact Support") {
      window.location.href = "mailto:support@aiinterviewprep.com?subject=Support%20request&body=Hello%20team%2C%20I%20need%20help%20with%20my%20account.";
      setNotice("Support email draft opened.");
      return;
    }
    const footerNotices = {
      "About Us": "About Us details are available in-app once you log in.",
      "Privacy Policy": "Privacy policy is available in-app once you log in.",
      "Terms of Service": "Terms of service are available in-app once you log in."
    };
    setNotice(footerNotices[label] || `${label} is available in-app after login.`);
  }
  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      if (isLogin) {
        await login({ email: form.email, password: form.password, rememberMe });
      } else {
        await signup(form);
      }
    } catch (requestError) {
      setError(requestError.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  return <div className="relative min-h-screen overflow-hidden bg-[#050811] text-white"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_6%,rgba(249,115,22,0.22),transparent_32%),radial-gradient(circle_at_52%_0%,rgba(59,130,246,0.2),transparent_45%),radial-gradient(circle_at_88%_85%,rgba(37,99,235,0.15),transparent_35%)]" /><div
      className="pointer-events-none absolute inset-0 animate-pulseSoft opacity-35"
      style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.24) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />
    <div className="relative z-10 flex min-h-screen flex-col">{!authOnlyView && showAuthPanel ? <header className="relative z-30 border-b border-white/10 bg-[#1f2f86] text-white"><div ref={navRef} className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-8"><nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base font-semibold sm:gap-x-8 sm:text-xl"><div className="relative"><button
                type="button"
                onClick={() => toggleMenu("products")}
                className="inline-flex items-center gap-1 transition hover:text-blue-200">
                
                  Products
                  <ChevronDown size={16} className={openMenu === "products" ? "rotate-180 transition" : "transition"} /></button>{openMenu === "products" ? <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-[min(92vw,360px)] rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl"><div className="space-y-2">{productMenuItems.map(({ label, description, icon: Icon }) => <button
                    key={label}
                    type="button"
                    onClick={() => handleNavAction(label)}
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition hover:bg-slate-100">
                    <span className="mt-1 text-blue-600"><Icon size={18} /></span><span><span className="block text-lg font-semibold leading-tight">{label}</span><span className="mt-1 block text-sm text-slate-500">{description}</span></span></button>)}</div></div> : null}</div><div className="relative"><button
                type="button"
                onClick={() => toggleMenu("jobs")}
                className="inline-flex items-center gap-1 transition hover:text-blue-200">
                
                  Jobs
                  <ChevronDown size={16} className={openMenu === "jobs" ? "rotate-180 transition" : "transition"} /></button>{openMenu === "jobs" ? <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(92vw,360px)] rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl sm:left-0 sm:right-auto"><div className="space-y-2">{jobsMenuItems.map(({ label, description, icon: Icon }) => <button
                    key={label}
                    type="button"
                    onClick={() => handleNavAction(label)}
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition hover:bg-slate-100">
                    <span className="mt-1 text-blue-600"><Icon size={18} /></span><span><span className="block text-lg font-semibold leading-tight">{label}</span><span className="mt-1 block text-sm text-slate-500">{description}</span></span></button>)}</div></div> : null}</div><button type="button" onClick={() => handleNavAction("Pricing")} className="transition hover:text-blue-200">
                Pricing
              </button><button type="button" onClick={() => handleNavAction("About Us")} className="transition hover:text-blue-200">
                About Us
              </button></nav><button
            type="button"
            onClick={handleSignUpCta}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#1f2f86] transition hover:bg-blue-50 sm:px-6 sm:text-base">
            
              Sign Up Free
            </button></div></header> : null}<main className={authOnlyView ? "flex flex-1 items-center justify-center px-4 py-8 sm:px-8" : isLandingView ? "flex-1 p-0" : "flex-1 px-4 pb-10 pt-8 sm:px-8 lg:pt-12"}><div className={authOnlyView ? "w-full max-w-[440px]" : isLandingView ? "w-full" : "mx-auto w-full max-w-6xl space-y-10"}>{isLandingView ? <section className="relative min-h-screen w-full overflow-hidden"><div className="pointer-events-none absolute left-1/2 top-[-22%] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl animate-[spin_24s_linear_infinite]" /><div className="pointer-events-none absolute bottom-[-16%] right-[-10%] h-[320px] w-[320px] rounded-full bg-amber-300/10 blur-3xl animate-[spin_20s_linear_infinite_reverse]" /><motion.div
              className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-5 pb-6 pt-5 sm:px-10 sm:pt-6"
              variants={heroContainerVariants}
              initial="hidden"
              animate="show">
              <motion.div variants={heroItemVariants} className="flex items-center justify-between"><p className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
                    AI Interview Platform
                  </p><div className="flex items-center gap-2 sm:gap-3"><button
                    type="button"
                    onClick={handleLoginCta}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 sm:px-6 sm:text-base">
                    
                      Login
                    </button><button
                    type="button"
                    onClick={handleSignUpCta}
                    className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25 sm:px-6 sm:text-base">
                    
                      Sign up
                    </button></div></motion.div><motion.div variants={heroItemVariants} className="mx-auto mt-14 max-w-4xl text-center sm:mt-20"><h1 className="font-display text-4xl font-extrabold leading-tight text-white sm:text-6xl lg:text-7xl">
                    Crack Your Next Interview
                  </h1><p className="mx-auto mt-4 max-w-3xl text-base text-slate-300 sm:text-xl lg:text-2xl">
                    Practice and master your interview skills with AI-driven mock interviews and real-time feedback tailored to your career goals.
                  </p><button
                  type="button"
                  onClick={handleSignUpCta}
                  className="mt-7 rounded-full bg-white px-7 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-100 sm:px-12 sm:py-4 sm:text-xl">
                  
                    Sign Up & Practice
                  </button></motion.div><motion.div variants={heroItemVariants} className="mx-auto mt-8 grid w-full max-w-6xl gap-3 md:grid-cols-3"><motion.article whileHover={{ y: -4, scale: 1.01 }} className="rounded-2xl border border-white/15 bg-black/30 p-4 text-center backdrop-blur-md"><p className="text-3xl font-extrabold text-white">25K+</p><p className="text-sm text-slate-300">Mock Interviews Completed</p></motion.article><motion.article whileHover={{ y: -4, scale: 1.01 }} className="rounded-2xl border border-white/15 bg-black/30 p-4 text-center backdrop-blur-md"><p className="text-3xl font-extrabold text-white">4.8/5</p><p className="text-sm text-slate-300">Average Learner Rating</p></motion.article><motion.article whileHover={{ y: -4, scale: 1.01 }} className="rounded-2xl border border-white/15 bg-black/30 p-4 text-center backdrop-blur-md"><p className="text-3xl font-extrabold text-white">3 Steps</p><p className="text-sm text-slate-300">Practice, Analyze, Improve</p></motion.article></motion.div><motion.div variants={heroItemVariants} className="relative mt-auto h-[42vh] min-h-[280px] w-full sm:h-[48vh] sm:min-h-[380px]"><div className="absolute left-1/2 top-10 h-[260px] w-[320px] -translate-x-1/2 rounded-[58%_42%_52%_48%/45%_55%_45%_55%] border border-white/25 bg-[radial-gradient(circle_at_72%_18%,rgba(255,216,153,0.95),rgba(120,80,25,0.85)_28%,rgba(19,25,45,0.98)_66%,rgba(6,10,18,1)_100%)] blur-[1px] animate-float sm:h-[400px] sm:w-[560px]" /><div className="absolute left-1/2 top-[64px] h-[210px] w-[270px] -translate-x-1/2 rounded-[55%_45%_50%_50%/40%_60%_40%_60%] bg-[radial-gradient(circle_at_72%_20%,rgba(255,220,165,0.55),rgba(60,43,19,0.82)_35%,rgba(13,18,35,0.98)_100%)] blur-sm animate-float sm:top-[84px] sm:h-[320px] sm:w-[460px]" style={{ animationDelay: "0.5s" }} /><div className="absolute left-1/2 top-6 h-[290px] w-[350px] -translate-x-1/2 rounded-[60%_40%_50%_50%/42%_58%_45%_55%] border border-amber-100/25 shadow-[0_0_70px_rgba(251,191,36,0.2)] animate-pulseSoft sm:h-[430px] sm:w-[620px]" /><div className="absolute bottom-16 left-1 hidden rounded-3xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-md animate-float sm:left-16 sm:bottom-20 sm:block sm:px-6 sm:py-4" style={{ animationDelay: "0.4s" }}><p className="text-xs text-slate-300 sm:text-sm">Mock Interviews</p><p className="mt-1 text-xl font-semibold text-white sm:text-4xl">Practice Real Scenarios</p></div><div className="absolute bottom-10 right-1 hidden rounded-3xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-md animate-float sm:right-16 sm:bottom-14 sm:block sm:px-6 sm:py-4" style={{ animationDelay: "1s" }}><p className="text-xs text-slate-300 sm:text-sm">Feedback Quality</p><p className="mt-1 text-4xl font-bold text-white sm:text-6xl">96%</p><span className="mt-2 block h-1.5 w-20 rounded-full bg-white/75 sm:w-32" /></div></motion.div></motion.div></section> : null}{authOnlyView || showAuthPanel ? <section className={authOnlyView ? "w-full" : "grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center"}>{!authOnlyView ? <div className="order-2 min-w-0 lg:order-1"><div className="w-full rounded-[24px] border border-blue-200/20 bg-gradient-to-br from-slate-900/40 to-blue-700/10 p-3 shadow-[0_24px_60px_rgba(8,15,45,0.45)] backdrop-blur-sm"><div className="overflow-hidden rounded-[18px]"><img
                    src="/hero-left-replacement.png"
                    alt="Master your interview skills with AI"
                    className="h-auto w-full" />
                </div></div></div> : null}{showAuthPanel ? <div className="order-1 mx-auto w-full max-w-[440px] lg:order-2"><motion.section
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{ colorScheme: "light" }}
                className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-slate-900 shadow-[0_24px_60px_rgba(13,20,44,0.42)] sm:px-7 sm:py-7">
                <h2 className="text-center font-display text-3xl font-extrabold text-slate-900 sm:text-4xl">{isLogin ? "Welcome Back" : "Create Account"}</h2><p className="mt-2 text-center text-sm text-slate-600 sm:text-base">{isLogin ? "Log in to continue" : "Sign up to start your AI interview practice"}</p><form onSubmit={handleSubmit} className="mt-6 space-y-4">{!isLogin ? <label className="grid gap-1 text-sm font-medium text-slate-700">
                          Full Name
                          <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><UserRound size={15} /></span><input
                        value={form.name}
                        onChange={(event) => updateField("name", event.target.value)}
                        autoComplete="name"
                        placeholder="Your full name"
                        required
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 pl-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200" />
                    </div></label> : null}<label className="grid gap-1 text-sm font-medium text-slate-700">
                        Email Address
                        <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><AtSign size={15} /></span><input
                        type="email"
                        value={form.email}
                        onChange={(event) => updateField("email", event.target.value)}
                        autoComplete="email"
                        placeholder="Email Address"
                        required
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 pl-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200" />
                    </div></label><label className="grid gap-1 text-sm font-medium text-slate-700">
                        Password
                        <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Lock size={15} /></span><input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(event) => updateField("password", event.target.value)}
                        autoComplete={isLogin ? "current-password" : "new-password"}
                        minLength={8}
                        placeholder="Password"
                        required
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 pl-9 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200" />
                      <button
                        type="button"
                        onClick={() => setShowPassword((previous) => !previous)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        title={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><div className="flex flex-wrap items-center justify-between gap-y-2 text-sm"><label className="inline-flex items-center gap-2 text-slate-700"><input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      
                          Remember me
                        </label><button
                      type="button"
                      onClick={handleForgotPassword}
                      className="font-medium text-blue-600 transition hover:text-blue-700">
                      
                          Forgot Password?
                        </button></div><button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-70">
                    {loading ? "Please wait..." : isLogin ? "Log In" : "Create Account"}</button>{notice ? <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{notice}</p> : null}{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}</form><div className="my-5 flex items-center gap-3 text-sm text-slate-500"><span className="h-px flex-1 bg-slate-200" />
                      OR continue with
                      <span className="h-px flex-1 bg-slate-200" /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><button
                    type="button"
                    onClick={() => handleSocialLogin("Google")}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-bold text-[#ea4335]">
                          G
                        </span>
                        Google
                      </button><button
                    type="button"
                    onClick={() => handleSocialLogin("LinkedIn")}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base">
                    <Linkedin size={18} className="text-[#0a66c2]" />
                        LinkedIn
                      </button></div><p className="mt-6 text-center text-sm text-slate-600 sm:text-base">{isLogin ? "Don't have an account?" : "Already have an account?"}{" "}<button
                    type="button"
                    onClick={() => updateMode(isLogin ? "signup" : "login")}
                    className="font-semibold text-blue-600 transition hover:text-blue-700">
                    {isLogin ? "Sign Up" : "Log In"}</button></p>{isLogin ? <div className="mt-4 flex justify-center"><Link
                    to="/admin-login?next=/admin"
                    className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                    
                          Admin Login
                        </Link></div> : null}</motion.section></div> : null}</section> : null}{!authOnlyView && showAuthPanel ? <section className="relative overflow-hidden rounded-[28px] border border-blue-200/20 px-5 py-7 shadow-[0_24px_70px_rgba(6,12,38,0.45)] sm:px-8 sm:py-8"><div className="absolute inset-0"><img
                src="/career-banner-reference.png"
                alt="Career mentorship"
                className="h-full w-full object-cover object-center opacity-20" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#214f98]/92 via-[#143d7d]/90 to-[#0b2a5a]/95" /></div><div className="relative grid gap-7 lg:grid-cols-[1.08fr_0.92fr] lg:items-start"><div><h3 className="font-display text-3xl font-extrabold leading-tight text-white sm:text-4xl">
                    Unlock Your <span className="text-sky-300">Career Potential.</span></h3><div className="mt-6 grid gap-3 sm:grid-cols-2">{impactStats.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-blue-100/25 bg-white/5 p-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-sky-200/60 bg-white/8 text-sky-100"><Icon size={22} /></span><div><p className="text-2xl font-extrabold leading-none text-white">{value}</p><p className="mt-1 text-sm font-medium text-blue-100 sm:text-base">{label}</p></div></div>)}</div></div><div className="border-t border-blue-200/25 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-sky-200/50 bg-white/10 text-sky-100"><TrendingUp size={24} /></span><p className="mt-3 max-w-md text-lg font-medium leading-snug text-white sm:text-xl">
                    Connect with top mentors like Tanmay, Nina, and Ichha for personalized guidance. Log in to book your
                    session.
                  </p><div className="mt-5 flex items-center">{mentorBadges.map((mentor, index) => <span
                    key={mentor.name}
                    title={mentor.name}
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-lg bg-gradient-to-br ${mentor.tone} ${index > 0 ? "-ml-2" : ""}`}>
                    {mentor.name.slice(0, 2).toUpperCase()}</span>)}</div></div></div></section> : null}</div></main>{!authOnlyView && showAuthPanel ? <footer className="relative border-t border-blue-200/15 bg-black/30 px-4 py-7 backdrop-blur-sm sm:px-8"><div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 text-center"><nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-slate-100 sm:gap-x-8 sm:text-base">{["About Us", "Privacy Policy", "Terms of Service", "Contact Support"].map((item) => <button key={item} type="button" onClick={() => handleFooterAction(item)} className="transition hover:text-sky-300">{item}</button>)}</nav><p className="text-xs text-slate-200/85 sm:text-sm">&copy; 2026 AI Interview Prep Inc. All rights reserved.</p></div><span className="pointer-events-none absolute bottom-5 right-5 h-4 w-4 rotate-45 rounded-sm bg-white/65 shadow-[0_0_20px_rgba(255,255,255,0.65)]" /></footer> : null}</div></div>;
}
