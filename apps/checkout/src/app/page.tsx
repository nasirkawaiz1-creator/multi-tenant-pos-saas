"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@pos/api-client";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@pos/ui";

export default function LoginPage() {
  const router = useRouter();
  // Fixed strictly to Imdad Cosmetics so no other demo store can be chosen
  const [storeId] = useState("imdad-cosmetics");
  const [email, setEmail] = useState("owner@imdad.com");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ storeId, email, password }),
      });

      setToken(res.token);
      router.push("/checkout");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">Imdad Cosmetics POS</CardTitle>
            <p className="text-sm text-slate-500">Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 font-medium">
                  {error}
                </div>
              )}

              {/* Locked store field */}
              <input type="hidden" value={storeId} />

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={loading}>
                {loading ? "Signing in..." : "Sign in to Imdad Cosmetics"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
