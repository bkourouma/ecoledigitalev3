import { NextRequest, NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue";
import { catalogueFiltersSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const rawFilters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = catalogueFiltersSchema.safeParse(rawFilters);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Filtres invalides." },
      { status: 400 }
    );
  }

  const data = await getCatalogue(parsed.data);
  return NextResponse.json(data);
}
