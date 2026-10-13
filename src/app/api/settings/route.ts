import { NextResponse } from "next/server";
import { getSettings, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  let body: { feeAmount?: unknown; tolerance?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const feeAmount = Number(body.feeAmount);
  const tolerance = Number(body.tolerance);

  if (!Number.isFinite(feeAmount) || feeAmount < 0) {
    return NextResponse.json({ error: "feeAmount must be a non-negative number." }, { status: 400 });
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return NextResponse.json({ error: "tolerance must be a non-negative number." }, { status: 400 });
  }

  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    update: { feeAmount, tolerance },
    create: { id: "default", feeAmount, tolerance },
  });

  return NextResponse.json(settings);
}
