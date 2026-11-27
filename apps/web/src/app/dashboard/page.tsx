"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, clearToken, getApiUrl, getToken } from "@pos/api-client";
import type { Tenant, User } from "@pos/types";
import {
  AppShell,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
} from "@pos/ui";

// The shop's own visiting card image, loaded with the login token (an <img> tag cannot send it).
function VisitingCard() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let objectUrl: string | null = null;

    fetch(`${getApiUrl()}/stores/current/card`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => undefined);

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  if (!src) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visiting Card</CardTitle>
        <CardDescription>The card this store was registered from.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Store visiting card" className="max-h-64 w-auto rounded-md border" />
      </CardContent>
    </Card>
  );
}

// Railway-style 1-month subscription countdown & limit card
function SubscriptionCard({ tenant }: { tenant: Tenant | null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!tenant) return null;

  const rawCreated =
    (tenant as Tenant & { createdAt?: string; created_at?: string }).createdAt ??
    (tenant as Tenant & { createdAt?: string; created_at?: string }).created_at;

  if (!rawCreated) return null;

  const created = new Date(rawCreated);
  const expiresAt = new Date(created);
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  const diffMs = expiresAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const isExpired = diffMs <= 0;

  const pktDateTime = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);

  const expiryDateText = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "medium",
  }).format(expiresAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Subscription Limit</CardTitle>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isExpired
                ? "bg-red-100 text-red-700"
                : daysLeft <= 5
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {isExpired ? "Expired" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}
          </span>
        </div>
        <CardDescription>1-month validity from store activation date.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm text-slate-700">
        <p className="text-lg font-semibold text-slate-900">
          {isExpired
            ? "0 days left — Limit expired"
            : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in your limit`}
        </p>
        <p>
          <span className="font-medium text-slate-900">Expiry Date:</span> {expiryDateText}
        </p>
        <p>
          <span className="font-medium text-slate-900">Current Date &amp; Time (PKT):</span> {pktDateTime}
        </p>
      </CardContent>
    </Card>
  );
}

// Self-service Change Password card for store owner privacy with show/hide toggle
function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch<{ success: boolean }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess("Password updated successfully. Only you know your new password now.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Security (Change Password)</CardTitle>
        <CardDescription>
          Update your temporary password so only you have access to your store &amp; khata data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <Label htmlFor="current-password">Current Password</Label>
            <div className="relative mt-1">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent((prev) => !prev)}
                aria-label={showCurrent ? "Hide current password" : "Show current password"}
                title={showCurrent ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2.5 flex items-center text-slate-500 hover:text-slate-800"
              >
                {showCurrent ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="new-password">New Password (min 8 characters)</Label>
            <div className="relative mt-1">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew((prev) => !prev)}
                aria-label={showNew ? "Hide new password" : "Show new password"}
                title={showNew ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2.5 flex items-center text-slate-500 hover:text-slate-800"
              >
                {showNew ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <div className="relative mt-1">
              <Input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm((prev) => !prev)}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                title={showConfirm ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2.5 flex items-center text-slate-500 hover:text-slate-800"
              >
                {showConfirm ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm font-medium text-emerald-700">{success}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }

    apiFetch<{ user: User; tenant: Tenant }>("/auth/me")
      .then((res) => {
        setUser(res.user);
        setTenant(res.tenant);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <AppShell
      title="POS SaaS"
      nav={
        <nav className="flex gap-4 text-sm">
          <a href="/dashboard" className="font-medium text-slate-900">
            Dashboard
          </a>
          <a href="/inventory" className="text-slate-600 hover:text-slate-900">
            Inventory
          </a>
          <a href="/checkout" className="text-slate-600 hover:text-slate-900">
            Checkout
          </a>
        </nav>
      }
    >
      <PageHeader
        title={`Welcome${user ? `, ${user.name}` : ""}`}
        description={tenant ? `${tenant.name} · ${tenant.plan} plan` : "Loading..."}
        actions={
          <Button variant="outline" onClick={handleLogout}>
            Sign out
          </Button>
