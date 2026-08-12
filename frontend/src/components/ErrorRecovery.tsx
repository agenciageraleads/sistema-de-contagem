"use client";

import { useEffect } from "react";

interface ErrorRecoveryProps {
  error?: Error & { digest?: string };
  reset?: () => void;
  title?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const shellStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "#eef4ff",
  color: "#0f172a",
  fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
} satisfies React.CSSProperties;

const cardStyle = {
  width: "min(520px, 100%)",
  background: "#ffffff",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderRadius: "18px",
  padding: "28px",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.14)",
} satisfies React.CSSProperties;

const titleStyle = {
  fontSize: "24px",
  lineHeight: 1.2,
  margin: "0 0 10px",
  fontWeight: 800,
} satisfies React.CSSProperties;

const textStyle = {
  fontSize: "15px",
  lineHeight: 1.55,
  margin: "0 0 22px",
  color: "#334155",
} satisfies React.CSSProperties;

const buttonStyle = {
  width: "100%",
  border: 0,
  borderRadius: "12px",
  padding: "16px 18px",
  background: "#0ea5e9",
  color: "#ffffff",
  fontWeight: 800,
  fontSize: "16px",
  cursor: "pointer",
} satisfies React.CSSProperties;

const detailStyle = {
  margin: "0 0 18px",
  padding: "12px",
  borderRadius: "10px",
  background: "#f8fafc",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  color: "#334155",
  fontSize: "12px",
  lineHeight: 1.5,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
} satisfies React.CSSProperties;

export function ErrorRecovery({ error, reset, title = "A tela precisa ser recarregada" }: ErrorRecoveryProps) {
  useEffect(() => {
    document.body.style.background = "#eef4ff";
  }, []);

  useEffect(() => {
    if (!error) return;

    const payload = {
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: error.stack?.slice(0, 4000),
      url: window.location.href,
      userAgent: window.navigator.userAgent,
      reportedAt: new Date().toISOString(),
    };

    fetch(`${API_URL}/diagnostics/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  const detail = error
    ? [error.name, error.message, error.digest ? `digest: ${error.digest}` : ""].filter(Boolean).join("\n")
    : "";

  const recover = async () => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      reset?.();
    } finally {
      const url = new URL(window.location.href);
      url.searchParams.set("v", Date.now().toString());
      window.location.replace(url.toString());
    }
  };

  return (
    <div style={shellStyle}>
      <section style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={textStyle}>
          Houve uma falha ao carregar a versao do sistema neste navegador. Use o botao abaixo para limpar os dados locais desta tela e baixar a versao atual.
        </p>
        {detail && <pre style={detailStyle}>{detail}</pre>}
        <button type="button" style={buttonStyle} onClick={recover}>
          Recarregar sistema
        </button>
      </section>
    </div>
  );
}
