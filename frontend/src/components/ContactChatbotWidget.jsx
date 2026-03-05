import { AnimatePresence, motion } from "framer-motion";
import { Bot, Mail, MessageSquare, Send, X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supportApi } from "../lib/api";

const DEFAULT_BOT_REPLY =
  "Hi, I am the support chatbot. Share your issue and our team will contact you.";

const QUICK_ACTIONS = [
  "I need interview setup help",
  "I have a login issue",
  "I found a bug"
];

export function ContactChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const location = useLocation();
  const { token, user } = useAuth();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || "support@aiinterview.app";

  async function submitSupportIssue() {
    const baseMessage = draft.trim() || "Hi team, I need help with...";
    if (baseMessage.length < 5) {
      setStatusError("Please describe your issue in at least 5 characters.");
      setStatusMessage("");
      return;
    }

    const pageUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${location.pathname}${location.search}`
        : `${location.pathname}${location.search}`;
    const submittedAt = new Date().toISOString();

    setSending(true);
    setStatusMessage("");
    setStatusError("");
    try {
      const payload = await supportApi.contact(token, {
        message: baseMessage,
        userName: String(user?.name || "").trim(),
        userEmail: String(user?.email || "").trim(),
        pageUrl,
        submittedAt
      });
      setStatusMessage(payload.message || "Issue sent to admin support.");
      setDraft("");
    } catch (requestError) {
      setStatusError(requestError.message || "Unable to send issue right now.");
    } finally {
      setSending(false);
    }
  }

  function applyQuickAction(text) {
    setStatusError("");
    setStatusMessage("");
    setDraft(text);
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[70] flex justify-end sm:inset-x-auto sm:bottom-5 sm:right-5">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            style={{ colorScheme: "light" }}
            className="glass-panel mb-3 w-full max-w-[360px] rounded-2xl p-3 sm:w-[340px]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                  Contact Us
                </p>
                <p className="font-display text-sm font-bold">Support Chatbot</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-white/70 p-1 text-slate-700 hover:bg-white dark:bg-slate-700/60 dark:text-slate-100"
                aria-label="Close contact chatbot"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-white/35 bg-white/70 p-2 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200">
              <p className="inline-flex items-center gap-2 font-semibold">
                <Bot size={13} />
                {DEFAULT_BOT_REPLY}
              </p>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => applyQuickAction(item)}
                  className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-brand-50 dark:bg-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {item}
                </button>
              ))}
            </div>

            <label className="mt-3 block">
              <span className="sr-only">Support message</span>
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-300 transition placeholder:text-slate-400 focus:ring-2"
                placeholder="Write your message..."
              />
            </label>

            {statusMessage ? (
              <p className="mt-2 rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                {statusMessage}
              </p>
            ) : null}
            {statusError ? (
              <p className="mt-2 rounded-lg bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700">
                {statusError}
              </p>
            ) : null}

            <div className="mt-2 flex items-center justify-between">
              <p className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-300">
                <Mail size={12} />
                {supportEmail}
              </p>
              <button
                type="button"
                onClick={submitSupportIssue}
                disabled={sending}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600"
              >
                <Send size={12} />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="group relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-cyan-500 text-white shadow-glass transition hover:scale-105 sm:h-12 sm:w-12"
        aria-label="Open contact chatbot"
        title="Contact support"
      >
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />
        <MessageSquare size={16} />
      </button>
    </div>
  );
}
