import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock3, CreditCard, Landmark, Smartphone } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { paymentApi } from "../lib/api";

const PLAN_DETAILS = {
  pro: {
    title: "Pro Plan",
    period: "/mo",
    features: ["Unlimited interviews", "Advanced score breakdown", "Priority support"],
    prices: {
      INR: 499,
      USD: 8,
      EUR: 7
    }
  },
  elite: {
    title: "Elite Plan",
    period: "/yr",
    features: ["Everything in Pro", "Career counselling priority", "Portfolio review sessions"],
    prices: {
      INR: 4499,
      USD: 79,
      EUR: 69
    }
  }
};

const CURRENCY_SYMBOL = {
  INR: "Rs",
  USD: "$",
  EUR: "EUR"
};

const STATUS_POLL_MS = 3500;
const UTR_REGEX = /^\d{12}$/;

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString();
}

function getSecondsLeft(expiresAt) {
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return 0;
  }
  return Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeUtrInput(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 12);
}

function isValidUtr(value) {
  return UTR_REGEX.test(value);
}

export function PaymentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token, refreshUser, user } = useAuth();
  const planKey = String(searchParams.get("plan") || "pro").toLowerCase();
  const currencyKey = String(searchParams.get("currency") || "INR").toUpperCase();

  const [method, setMethod] = useState("upi");
  const [payment, setPayment] = useState(null);
  const [utr, setUtr] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");

  const selectedPlan = useMemo(() => PLAN_DETAILS[planKey] || PLAN_DETAILS.pro, [planKey]);
  const selectedCurrency = useMemo(() => (CURRENCY_SYMBOL[currencyKey] ? currencyKey : "INR"), [currencyKey]);
  const paymentCurrency = "INR";
  const amount = selectedPlan.prices[paymentCurrency];
  const isPaid = payment?.status === "paid";
  const isPending = payment?.status === "pending";
  const isExpired = payment?.status === "expired";
  const normalizedUtr = normalizeUtrInput(utr);
  const hasUtrInput = normalizedUtr.length > 0;
  const isUtrValid = isValidUtr(normalizedUtr);

  async function refreshPaymentStatus() {
    if (!payment?.paymentId) {
      return;
    }

    try {
      const payload = await paymentApi.status(token, payment.paymentId);
      setPayment(payload.payment);

      if (payload.payment?.status === "paid") {
        setStatusText(`Timing Successful at ${formatTime(payload.payment.paidAt)}. Subscription activated.`);
        await refreshUser().catch(() => {});
      } else if (payload.payment?.status === "expired") {
        setStatusText("QR expired. Generate a fresh QR and try again.");
      }
    } catch (requestError) {
      setError(requestError.message || "Unable to refresh payment status.");
    }
  }

  async function createUpiIntent() {
    if (method !== "upi") {
      setError("Realtime flow currently supports UPI only. Please choose UPI.");
      return;
    }

    setBusy(true);
    setError("");
    setStatusText("");

    try {
      const payload = await paymentApi.createIntent(token, {
        plan: planKey,
        currency: paymentCurrency,
        method: "upi"
      });

      setPayment(payload.payment);
      setSecondsLeft(getSecondsLeft(payload.payment?.expiresAt));
      setStatusText("QR generated. Complete payment in your UPI app.");
    } catch (requestError) {
      setError(requestError.message || "Could not generate UPI QR.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    if (!payment?.paymentId) {
      return;
    }

    setConfirming(true);
    setError("");

    try {
      const payload = await paymentApi.confirm(token, payment.paymentId, { utr: normalizedUtr });
      setPayment(payload.payment);
      setStatusText(payload.message || `Timing Successful at ${formatTime(payload.payment?.paidAt)}.`);
      await refreshUser().catch(() => {});
    } catch (requestError) {
      setError(requestError.message || "Payment confirmation failed.");
    } finally {
      setConfirming(false);
    }
  }

  function openUpiApp() {
    if (!payment?.upiUri) {
      return;
    }
    window.location.href = payment.upiUri;
  }

  useEffect(() => {
    if (!isPending) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft(getSecondsLeft(payment?.expiresAt));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isPending, payment?.expiresAt]);

  useEffect(() => {
    if (!isPending) {
      return undefined;
    }

    const poller = window.setInterval(() => {
      refreshPaymentStatus();
    }, STATUS_POLL_MS);

    return () => window.clearInterval(poller);
  }, [isPending, payment?.paymentId, token]);

  useEffect(() => {
    if (secondsLeft === 0 && isPending) {
      refreshPaymentStatus();
    }
  }, [secondsLeft, isPending]);

  return (
    <div className="grid gap-3 sm:gap-4">
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <button
          type="button"
          onClick={() => navigate("/subscriptions")}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto sm:justify-start dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={14} />
          Back to Plans
        </button>

        <h1 className="mt-4 font-display text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-slate-100">Payment Options</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Complete your upgrade for <strong>{selectedPlan.title}</strong>.
        </p>
      </section>

      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="text-sm text-slate-600 dark:text-slate-300">Plan Summary</p>
          <p className="mt-1 font-display text-xl font-extrabold text-slate-900 sm:text-2xl dark:text-slate-100">
            {selectedPlan.title}: {CURRENCY_SYMBOL[paymentCurrency]} {amount}
            {selectedPlan.period}
          </p>
          {selectedCurrency !== "INR" ? (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              UPI flow uses INR. Amount converted to INR for payment.
            </p>
          ) : null}
          <div className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            {selectedPlan.features.map((feature) => (
              <p key={feature}>- {feature}</p>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setMethod("upi")}
            className={[
              "rounded-xl border p-4 text-left transition",
              method === "upi"
                ? "border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10"
                : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
            ].join(" ")}
          >
            <Smartphone size={18} className="text-brand-500" />
            <p className="mt-2 font-semibold text-slate-900 dark:text-slate-100">UPI</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Auto QR + realtime status</p>
          </button>

          <button
            type="button"
            disabled
            className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-left opacity-60 dark:border-slate-700 dark:bg-slate-900"
          >
            <CreditCard size={18} className="text-slate-500" />
            <p className="mt-2 font-semibold text-slate-700 dark:text-slate-200">Card</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Coming soon</p>
          </button>

          <button
            type="button"
            disabled
            className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-left opacity-60 dark:border-slate-700 dark:bg-slate-900"
          >
            <Landmark size={18} className="text-slate-500" />
            <p className="mt-2 font-semibold text-slate-700 dark:text-slate-200">Net Banking</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Coming soon</p>
          </button>
        </div>

        <button
          type="button"
          onClick={createUpiIntent}
          disabled={busy || confirming}
          className="mt-4 w-full rounded-xl bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-600 sm:text-sm disabled:opacity-70"
        >
          {busy ? "Generating QR..." : `Generate UPI QR for ${CURRENCY_SYMBOL[paymentCurrency]} ${amount}`}
        </button>

        {payment ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <img src={payment.qrCodeUrl} alt="UPI payment QR" className="mx-auto h-48 w-48 rounded-md bg-white p-2 sm:h-56 sm:w-56" />
              </div>

              <div className="grid gap-2 text-sm">
                <p className="break-all font-semibold text-slate-900 dark:text-slate-100">UPI ID: {payment.upiId}</p>
                <p className="break-all text-slate-600 dark:text-slate-300">Payment Ref: {payment.paymentId}</p>
                <p className="text-slate-600 dark:text-slate-300">
                  Amount: {CURRENCY_SYMBOL[payment.currency] || payment.currency} {payment.amount}
                </p>
                <p className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Clock3 size={14} />
                  {isPending ? `Expires in ${formatCountdown(secondsLeft)}` : "Payment window closed"}
                </p>

                <div className="mt-1 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                  <button
                    type="button"
                    onClick={openUpiApp}
                    disabled={!isPending}
                    className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 sm:w-auto disabled:opacity-70"
                  >
                    Open UPI App
                  </button>
                  <button
                    type="button"
                    onClick={refreshPaymentStatus}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:w-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Check Status
                  </button>
                </div>

                <label className="mt-2 grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  UTR / UPI Ref (required)
                  <input
                    value={utr}
                    onChange={(event) => setUtr(normalizeUtrInput(event.target.value))}
                    placeholder="Enter 12-digit UTR after payment"
                    inputMode="numeric"
                    pattern="[0-9]{12}"
                    maxLength={12}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>

                <button
                  type="button"
                  onClick={confirmPayment}
                  disabled={confirming || !isPending || !isUtrValid}
                  className="mt-1 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto disabled:opacity-70"
                >
                  {confirming ? "Confirming..." : "I Have Paid"}
                </button>
                {!hasUtrInput ? (
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Subscription activate karne ke liye UTR dena required hai.
                  </p>
                ) : null}
                {hasUtrInput && !isUtrValid ? (
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    UTR exactly 12 digits ka hona chahiye.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {statusText ? (
          <p
            className={[
              "mt-3 rounded-lg px-3 py-2 text-sm font-semibold",
              isPaid ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"
            ].join(" ")}
          >
            {statusText}
          </p>
        ) : null}

        {isPaid ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            <p className="inline-flex items-center gap-2 font-semibold">
              <CheckCircle2 size={16} />
              Subscription active: {(user?.subscription?.plan || planKey).toUpperCase()}
            </p>
            <p className="mt-1">
              Valid till:{" "}
              {user?.subscription?.currentPeriodEnd
                ? new Date(user.subscription.currentPeriodEnd).toLocaleString()
                : "Updating..."}
            </p>
          </div>
        ) : null}

        {isExpired ? (
          <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
            Payment request expired. Please generate a fresh QR.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
