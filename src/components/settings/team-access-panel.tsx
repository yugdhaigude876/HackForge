"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Panel } from "@/components/finance/panels";
import { apiFetch } from "@/lib/api-client";
import { useOrgRole, type OrgRole } from "@/hooks/use-org-role";

interface InviteRow {
  email: string;
  role: OrgRole;
  claimed: boolean;
}

interface InviteList {
  memberCount: number;
  invites: InviteRow[];
}

/** Admin-only: invite real people by email. They get the chosen role on first verified sign-in. */
export function TeamAccessPanel() {
  const { role, loading, isLive } = useOrgRole();
  const [list, setList] = useState<InviteList | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<OrgRole>("analyst");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = role === "admin";

  const refresh = useCallback(async () => {
    const res = await apiFetch<InviteList>("/api/org/invites");
    if (res.ok) {
      setList(res.data);
      setError(null);
    } else {
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of server state
    void refresh();
  }, [isAdmin, refresh]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const res = await apiFetch("/api/org/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role: newRole }),
    });
    setBusy(false);
    if (res.ok) {
      setEmail("");
      await refresh();
    } else {
      setError(res.error.message);
    }
  };

  const remove = async (target: string) => {
    const res = await apiFetch("/api/org/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target }),
    });
    if (res.ok) await refresh();
    else setError(res.error.message);
  };

  return (
    <Panel title="Team access" description="Only invited, verified accounts can enter this organisation.">
      {!isLive ? (
        <p className="text-xs text-muted">Team access applies to real Firebase accounts.</p>
      ) : loading ? (
        <p className="text-xs text-muted">Loading your role…</p>
      ) : !isAdmin ? (
        <p className="text-xs text-muted">
          Your role is <span className="font-medium text-foreground">{role ?? "viewer"}</span>. Only admins can invite
          people.
        </p>
      ) : (
        <div className="space-y-4">
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              aria-label="Email to invite"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 text-xs text-foreground"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as OrgRole)}
              aria-label="Role"
              className="h-9 rounded-md border border-border bg-surface-2 px-2 text-xs text-foreground"
            >
              <option value="viewer">Viewer</option>
              <option value="analyst">Analyst</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" size="sm" disabled={busy}>
              <UserPlus className="h-3.5 w-3.5" />
              <span>Invite</span>
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          )}

          <ul className="divide-y divide-border text-xs">
            {list?.invites.length === 0 && <li className="py-2 text-muted">No invitations yet.</li>}
            {list?.invites.map((i) => (
              <li key={i.email} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{i.email}</span>
                <Badge tone="info">{i.role}</Badge>
                <Badge tone={i.claimed ? "positive" : "neutral"}>{i.claimed ? "Joined" : "Pending"}</Badge>
                <button
                  type="button"
                  onClick={() => remove(i.email)}
                  aria-label={`Remove invitation for ${i.email}`}
                  className="text-muted hover:text-negative"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {list && <p className="text-[11px] text-muted">{list.memberCount} member(s) in this organisation.</p>}
        </div>
      )}
    </Panel>
  );
}
