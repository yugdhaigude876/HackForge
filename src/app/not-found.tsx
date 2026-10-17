import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted">404 — page not found</p>
      <Link href="/dashboard" className="text-sm text-primary underline">
        Back to dashboard
      </Link>
    </main>
  );
}
