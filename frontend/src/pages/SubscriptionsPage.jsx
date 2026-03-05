import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Circle, Crown, RefreshCcw, Rocket, Sparkles, TrendingUp, Zap } from "lucide-react";
import { sessionApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getCompletedPracticeSessions } from "../lib/practiceStorage";

const PLAN_LIMIT = 3;
const CURRENCY_KEY = "code_with_warrior_subscription_currency_v1";
const CURRENCY_OPTIONS = {
  INR: { symbol: "Rs", monthly: 499, yearly: 4499 },
  USD: { symbol: "$", monthly: 8, yearly: 79 },
  EUR: { symbol: "EUR", monthly: 7, yearly: 69 }
};

const PLAN_META = {
  free: {
    title: "Free",
    subtitle: "Starter access for evaluation",
    features: ["3 interviews per cycle", "Basic analytics", "Community support"]
  },
  pro: {
    title: "Pro",
    subtitle: "Best for active job seekers",
    features: ["Unlimited interviews", "Advanced score breakdown", "Priority support"]
  },
  elite: {
    title: "Elite",
    subtitle: "For serious placement outcomes",
    features: ["Everything in Pro", "Career counselling priority", "Portfolio review sessions"]
  }
};

function toBillingCycleKey(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getSessionCompletionDate(session) {
  if (!session || session.status !== "completed") {
    return null;
  }
  const source = session.endedAt || session.updatedAt || session.createdAt;
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveCurrency() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "INR";
  }
  try {
    const value = String(window.localStorage.getItem(CURRENCY_KEY) || "INR").toUpperCase();
    return CURRENCY_OPTIONS[value] ? value : "INR";
  } catch {
    return "INR";
  }
}

function saveCurrency(value) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(CURRENCY_KEY, value);
  } catch {
  }
}

function formatMoney(currencyCode, amount) {
  const currency = CURRENCY_OPTIONS[currencyCode] || CURRENCY_OPTIONS.INR;
  return `${currency.symbol} ${amount}`;
}

function StatPanel({ title, value, subtitle }) {
  return (
    <article className="rounded-2xl border border-white/40 bg-white/70 p-4 text-center shadow-soft dark:border-white/10 dark:bg-slate-900/45">
      <p className="font-display text-3xl font-extrabold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
    </article>
  );
}

function PlanCard({
  title,
  description,
  priceLabel,
  features,
  active,
  onChoose,
  disabled = false,
  ctaLabel = "",
  featured = false
}) {
  return (
    <article
      className={[
        "relative overflow-hidden rounded-2xl border p-5 transition",
        featured
          ? "border-brand-400 bg-white shadow-glass dark:border-brand-400/70 dark:bg-slate-900/60"
          : "border-white/40 bg-white/70 shadow-soft dark:border-white/10 dark:bg-slate-900/45",
        !active && !disabled ? "hover:-translate-y-1 hover:shadow-glass" : ""
      ].join(" ")}
    >
      {featured ? (
        <span className="absolute right-3 top-3 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          Most Popular
        </span>
      ) : null}

      <p className="font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
      <p className="mt-4 font-display text-4xl font-extrabold text-slate-900 dark:text-slate-100">{priceLabel}</p>

      <div className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
        {features.map((feature) => (
          <p key={`${title}-${feature}`} className="inline-flex items-center gap-2">
            <Zap size={14} className="text-brand-500" />
            {feature}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={onChoose}
        disabled={active || disabled}
        className={[
          "mt-5 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition",
          active || disabled
            ? "cursor-default bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            : featured
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        ].join(" ")}
      >
        {active ? "Current Plan" : ctaLabel || "Choose Plan"}
      </button>
    </article>
  );
}

export function SubscriptionsPage() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("current");
  const [currency, setCurrency] = useState(() => resolveCurrency());
  const [coupon, setCoupon] = useState("");
  const [referral, setReferral] = useState("");
  const [billingNotice, setBillingNotice] = useState("");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await sessionApi.list(token);
      setSessions(payload.sessions || []);
    } catch (requestError) {
      setError(requestError.message || "Could not load subscription usage.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  function onCurrencyChange(value) {
    setCurrency(value);
    saveCurrency(value);
  }

  const usage = useMemo(() => {
    const now = new Date();
    const currentCycleKey = toBillingCycleKey(now);

    const remoteCompleted = sessions
      .map((session) => ({
        id: String(session?.id || "").trim(),
        date: getSessionCompletionDate(session)
      }))
      .filter((entry) => entry.id && entry.date);

    const remoteIds = new Set(remoteCompleted.map((entry) => entry.id));
    const localOnlyCompleted = getCompletedPracticeSessions(user)
      .map((entry) => ({
        id: String(entry.sessionId || "").trim(),
        date: new Date(entry.completedAt)
      }))
      .filter((entry) => entry.id && !remoteIds.has(entry.id) && !Number.isNaN(entry.date.getTime()));

    const combinedCompleted = [...remoteCompleted, ...localOnlyCompleted];
    const completedThisCycle = combinedCompleted.filter((entry) => toBillingCycleKey(entry.date) === currentCycleKey).length;
    const completedTotal = combinedCompleted.length;
    const activePlan = String(user?.subscription?.plan || "free").toLowerCase();
    const isUnlimited = ["pro", "elite"].includes(activePlan);
    const used = isUnlimited ? completedThisCycle : Math.min(PLAN_LIMIT, completedThisCycle);
    const remaining = isUnlimited ? "Unlimited" : Math.max(0, PLAN_LIMIT - used);
    const percent = Math.min(100, Math.round((Math.min(used, PLAN_LIMIT) / PLAN_LIMIT) * 100));

    return { used, remaining, percent, completedTotal, isUnlimited };
  }, [sessions, user]);

  const currentPlanKey = String(user?.subscription?.plan || "free").toLowerCase();
  const currentPlanTitle = currentPlanKey === "elite" ? "Elite Plan" : currentPlanKey === "pro" ? "Pro Plan" : "Free Plan";
  const subscriptionStatus = String(user?.subscription?.status || "active").toLowerCase();
  const currentPlanEndDate = user?.subscription?.currentPeriodEnd ? new Date(user.subscription.currentPeriodEnd).toLocaleString() : "";
  const selectedCurrency = CURRENCY_OPTIONS[currency] || CURRENCY_OPTIONS.INR;

  const trialEndsAt = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 5);
    return date;
  }, []);

  const trialCountdown = useMemo(() => {
    const now = new Date();
    const diffMs = trialEndsAt.getTime() - now.getTime();
    const totalHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${hours}h`;
  }, [trialEndsAt]);

  function applyBillingBenefits() {
    if (!coupon.trim() && !referral.trim()) {
      setBillingNotice("Enter coupon or referral code to apply.");
      return;
    }
    setBillingNotice("Offer applied. Discount preview will reflect at checkout.");
  }

  function redirectToPayment(plan) {
    const params = new URLSearchParams({ plan, currency });
    navigate(`/subscriptions/payment?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      <section className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/70 p-5 shadow-glass dark:border-white/10 dark:bg-slate-900/45">
        <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-500/20" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-28 w-28 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/20" />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white dark:bg-slate-100 dark:text-slate-900">
              <Rocket size={12} />
              Sell-Ready Plans
            </p>
            <h1 className="mt-2 font-display text-4xl font-extrabold text-slate-900 dark:text-slate-100">Subscriptions</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Position your product with clear value, transparent pricing, and upgrade momentum.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSessions}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCcw size={14} />
              Refresh
            </button>
            <select
              value={currency}
              onChange={(event) => onCurrencyChange(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              {Object.keys(CURRENCY_OPTIONS).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatPanel title="Current Plan" value={currentPlanTitle.replace(" Plan", "")} subtitle={`Status: ${subscriptionStatus.toUpperCase()}`} />
          <StatPanel title="Interviews This Cycle" value={usage.used} subtitle={usage.isUnlimited ? "Unlimited active" : `${PLAN_LIMIT} monthly cap`} />
          <StatPanel title="Trial Pressure" value={trialCountdown} subtitle="to unlock best offer" />
        </div>

        <div className="mt-4 flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setTab("current")}
            className={[
              "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition",
              tab === "current" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-300"
            ].join(" ")}
          >
            Current Plan
          </button>
          <button
            type="button"
            onClick={() => setTab("upgrade")}
            className={[
              "flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition",
              tab === "upgrade" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-300"
            ].join(" ")}
          >
            Upgrade Plans
          </button>
        </div>
      </section>

      {tab === "current" ? (
        <>
          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-soft dark:border-white/10 dark:bg-slate-900/45">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                  <Crown size={18} />
                </span>
                <div>
                  <p className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">{currentPlanTitle}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{PLAN_META[currentPlanKey]?.subtitle || "Active plan details"}</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                {subscriptionStatus.toUpperCase()}
              </span>
            </div>

            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-600 dark:text-slate-300">
                <span>Interview Usage</span>
                <span>{usage.isUnlimited ? `${usage.used} completed (Unlimited)` : `${usage.used} of ${PLAN_LIMIT} used`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full bg-gradient-to-r from-brand-500 to-emerald-500" style={{ width: `${usage.percent}%` }} />
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200 md:grid-cols-3">
              {(PLAN_META[currentPlanKey]?.features || PLAN_META.free.features).map((feature) => (
                <p key={feature} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                  <BadgeCheck size={14} className="text-brand-500" />
                  {feature}
                </p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setTab("upgrade")}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              <Sparkles size={15} />
              {currentPlanKey === "free" ? "Upgrade to Pro Now" : "View Upgrade Options"}
            </button>

            {currentPlanEndDate ? (
              <p className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300">Valid till: {currentPlanEndDate}</p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-soft dark:border-white/10 dark:bg-slate-900/45">
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                <TrendingUp size={16} />
              </span>
              <div>
                <p className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Usage Overview</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Live metrics to drive conversion nudges.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <StatPanel title="Completed" value={usage.used} subtitle={`Total sessions: ${usage.completedTotal}`} />
              <StatPanel title="Remaining" value={usage.remaining} subtitle="this billing cycle" />
              <StatPanel title="Value Plan" value={selectedCurrency.symbol} subtitle={`${selectedCurrency.monthly}/mo Pro`} />
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-white/40 bg-white/70 p-5 shadow-soft dark:border-white/10 dark:bg-slate-900/45">
          <div className="mb-4">
            <h2 className="font-display text-3xl font-bold text-slate-900 dark:text-slate-100">Choose your plan</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Communicate a clear upgrade path: Free to Pro for consistency, Elite for serious outcomes.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <PlanCard
              title="Free"
              description={PLAN_META.free.subtitle}
              priceLabel={`${selectedCurrency.symbol} 0`}
              features={PLAN_META.free.features}
              active={currentPlanKey === "free"}
              disabled={currentPlanKey !== "free"}
              ctaLabel="Free Plan"
            />

            <PlanCard
              title="Pro"
              description={PLAN_META.pro.subtitle}
              priceLabel={`${formatMoney(currency, selectedCurrency.monthly)}/mo`}
              features={PLAN_META.pro.features}
              active={currentPlanKey === "pro"}
              onChoose={() => redirectToPayment("pro")}
              featured
            />

            <PlanCard
              title="Elite"
              description={PLAN_META.elite.subtitle}
              priceLabel={`${formatMoney(currency, selectedCurrency.yearly)}/yr`}
              features={PLAN_META.elite.features}
              active={currentPlanKey === "elite"}
              onChoose={() => redirectToPayment("elite")}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">Plan Comparison</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    <th className="py-2">Feature</th>
                    <th className="py-2">Free</th>
                    <th className="py-2">Pro</th>
                    <th className="py-2">Elite</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">Mock interviews per cycle</td>
                    <td className="py-2">3</td>
                    <td className="py-2">Unlimited</td>
                    <td className="py-2">Unlimited</td>
                  </tr>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">AI feedback depth</td>
                    <td className="py-2">Basic</td>
                    <td className="py-2">Advanced</td>
                    <td className="py-2">Advanced + Mentor Review</td>
                  </tr>
                  <tr>
                    <td className="py-2">Mentor booking priority</td>
                    <td className="py-2">No</td>
                    <td className="py-2">Standard</td>
                    <td className="py-2">Highest</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Coupon Code
              <input
                value={coupon}
                onChange={(event) => setCoupon(event.target.value)}
                placeholder="e.g. CWW50"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Referral Code
              <input
                value={referral}
                onChange={(event) => setReferral(event.target.value)}
                placeholder="Friend code"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={applyBillingBenefits}
                className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Apply Offer
              </button>
            </div>
          </div>

          {billingNotice ? (
            <p className="mt-3 rounded-lg bg-brand-100 px-3 py-2 text-sm font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
              {billingNotice}
            </p>
          ) : null}

          <p className="mt-4 inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Circle size={10} />
            {loading ? "Refreshing usage data..." : "Billing summary updates automatically with completed interviews."}
          </p>
        </section>
      )}
    </div>
  );
}
