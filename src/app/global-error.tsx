"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Root Error caught]:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[#0a101d] text-slate-100 min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#152238] border border-slate-700/60 rounded-xl p-8 text-center shadow-xl">
          <div className="h-12 w-12 rounded-full bg-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Application Error</h1>
          <p className="text-sm text-slate-300 mb-6">
            A critical error occurred while initializing the application.
          </p>
          <button
            onClick={() => reset()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
          >
            Reload application
          </button>
        </div>
      </body>
    </html>
  );
}
