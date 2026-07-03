import { NextResponse } from "next/server";

/**
 * Public (server-side) list of tenants for the login page selector.
 *
 * Runs on the Next.js server: it authenticates against the backend using the
 * super-admin credentials from the environment (never exposed to the browser),
 * then returns only non-sensitive fields (slug + name). No extra backend
 * endpoint and no API server restart required.
 */
export const dynamic = "force-dynamic";

function apiBaseUrl(): string {
  return (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000"
  );
}

export async function GET() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    return NextResponse.json({ tenants: [] });
  }

  try {
    const loginRes = await fetch(`${apiBaseUrl()}/api/v1/super-admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });

    if (!loginRes.ok) {
      return NextResponse.json({ tenants: [] });
    }

    const { token } = (await loginRes.json()) as { token?: string };
    if (!token) {
      return NextResponse.json({ tenants: [] });
    }

    const tenantsRes = await fetch(`${apiBaseUrl()}/api/v1/super-admin/tenants`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!tenantsRes.ok) {
      return NextResponse.json({ tenants: [] });
    }

    const data = (await tenantsRes.json()) as {
      tenants?: Array<{ slug: string; name: string; is_active?: boolean }>;
    };

    const tenants = (data.tenants || [])
      .filter((t) => t.is_active !== false)
      .map((t) => ({ slug: t.slug, name: t.name }));

    return NextResponse.json({ tenants });
  } catch {
    return NextResponse.json({ tenants: [] });
  }
}
