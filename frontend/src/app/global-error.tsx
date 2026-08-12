"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <ErrorRecovery error={error} reset={reset} title="Precisamos atualizar esta tela" />
      </body>
    </html>
  );
}
