export function Footer() {
  return (
    <footer className="mt-auto border-t border-ink-border py-8 text-center text-sm text-ink-muted">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 sm:flex-row sm:justify-between">
        <p>
          Built on <span className="text-cyan-accent">Injective</span> · Injective
          Global Cup 2026
        </p>
        <div className="flex gap-4">
          <a
            href="https://github.com"
            className="hover:text-white"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a href="/explorer" className="hover:text-white">
            Docs
          </a>
          <span className="text-ink-border">|</span>
          <span>MCP · x402 · CCTP · Agent Skills</span>
        </div>
      </div>
    </footer>
  );
}
