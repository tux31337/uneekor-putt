/** Local development diagnostics for GPU failures that TypeScript/build checks cannot detect. */
export function reportRenderDiagnostic(stage: string, detail: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  void fetch(`${import.meta.env.BASE_URL}__putting-diagnostics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, detail, time: new Date().toISOString() }),
  }).catch(() => { /* Diagnostics must never interrupt rendering. */ });
}
